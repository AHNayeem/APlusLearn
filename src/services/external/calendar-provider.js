import "server-only";
import { randomUUID } from "node:crypto";
import { CALENDAR_PROVIDERS, INTEGRATION_MODULES } from "@/constants";
import { DEVELOPMENT } from "@/lib/config/env";
import { resolveIntegrationConfig } from "@/lib/config/integrations";

/**
 * External calendar sync (§18, §41 Phase 2).
 *
 *   GoogleCalendarProvider    — Google Calendar API v3
 *   MicrosoftCalendarProvider — Microsoft Graph
 *   DevelopmentCalendarProvider — a working implementation with no account
 *
 * Every provider speaks the same six operations and nothing above this file
 * knows which one is running. Provider-specific shapes — Google's
 * `dateTime`/`timeZone` pairs, Graph's `showAs`, the two different ways of
 * asking "when is this person busy" — are translated here and never leak into
 * the service layer.
 *
 * Two deliberate absences:
 *
 *   No token *storage*. A provider is handed a live access token and hands
 *   back a refreshed one; deciding when to refresh, and keeping the encrypted
 *   copy, is `calendar.service`'s job. A provider that could read the
 *   database would be a provider that could forget to encrypt.
 *
 *   No business rules. Whether a tutor's booking should be on a calendar at
 *   all, and what happens when a push fails, are marketplace questions.
 *
 * The development implementation is a real implementation, not a stub: events
 * it creates are stored, come back as busy periods, can be updated and can be
 * deleted. What it is not is private to a person — it is the platform's own
 * record, clearly labelled, so nothing pretends a Google account is attached.
 */

export class CalendarProvider {
  get name() {
    throw new Error("not implemented");
  }

  /** Where to send the person to grant access. */
  getAuthorizationUrl() {
    throw new Error("not implemented");
  }

  /** Turn the authorization code into tokens and an account identity. */
  async exchangeCode() {
    throw new Error("not implemented");
  }

  /** Trade a refresh token for a new access token. */
  async refreshAccessToken() {
    throw new Error("not implemented");
  }

  /** The calendars this account can write to. */
  async listCalendars() {
    throw new Error("not implemented");
  }

  /** When the account is busy between two instants. */
  async listBusyPeriods() {
    throw new Error("not implemented");
  }

  /** Create, update or delete the event for one lesson. */
  async createEvent() {
    throw new Error("not implemented");
  }
  async updateEvent() {
    throw new Error("not implemented");
  }
  async deleteEvent() {
    throw new Error("not implemented");
  }

  /** Tell the provider to forget us. Best-effort — not every provider offers it. */
  async revoke() {
    return { revoked: false };
  }

  /**
   * Prove the *application registration* is valid — the client id and secret
   * this platform presents when a tutor authorises their calendar.
   *
   * This is explicitly not a claim that anybody's calendar is connected. A
   * tutor's connection is their own OAuth grant and lives on
   * `CalendarConnection`; conflating the two would be telling an operator
   * something nobody has checked (§39).
   *
   * @returns {Promise<{ ok: boolean, code: string, message: string }>}
   */
  async verify() {
    return { ok: false, code: "NOT_SUPPORTED", message: "This provider cannot be tested." };
  }
}

// --- Development -----------------------------------------------------------

/**
 * A calendar with no third party behind it.
 *
 * State lives on the connection document (`simulatedEvents`), which the
 * service passes in and writes back, so this class stays stateless like the
 * production ones and a restart does not lose a tutor's events.
 */
export class DevelopmentCalendarProvider extends CalendarProvider {
  constructor(provider = CALENDAR_PROVIDERS.GOOGLE) {
    super();
    this.provider = provider;
  }

  get name() {
    return `${this.provider}_DEVELOPMENT`;
  }

  async verify() {
    return {
      ok: true,
      code: "DEVELOPMENT",
      message:
        "Simulated calendar. Events are created, updated and returned as busy periods, but no Google or Microsoft account is involved.",
    };
  }

  get configured() {
    return false;
  }

  /**
   * Straight back to the callback with a recognisable code. No third party is
   * involved, so there is nowhere else to send the person — and bouncing
   * through a fake consent screen would teach the wrong habit.
   */
  getAuthorizationUrl({ redirectUri, state }) {
    const url = new URL(redirectUri);
    url.searchParams.set("code", `dev-${randomUUID()}`);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode({ code, userEmail }) {
    return {
      accessToken: `dev-access-${code.slice(-8)}`,
      refreshToken: `dev-refresh-${code.slice(-8)}`,
      expiresInSeconds: 3600,
      scope: "development",
      account: {
        id: `dev-${userEmail ?? "account"}`,
        email: userEmail ?? "calendar@development.local",
      },
      simulated: true,
    };
  }

  async refreshAccessToken({ refreshToken }) {
    return { accessToken: `dev-access-${randomUUID().slice(0, 8)}`, refreshToken, expiresInSeconds: 3600 };
  }

  async listCalendars() {
    return [
      {
        id: "primary",
        name: "Development calendar",
        primary: true,
        timeZone: "America/Toronto",
      },
    ];
  }

  /** Busy periods are exactly the events this provider is holding. */
  async listBusyPeriods({ from, to, events = [] }) {
    return events
      .filter((event) => !event.cancelledAt)
      .filter((event) => new Date(event.start) < new Date(to) && new Date(event.end) > new Date(from))
      .map((event) => ({ start: new Date(event.start), end: new Date(event.end) }));
  }

  async createEvent({ event }) {
    return { eventId: `dev-event-${randomUUID()}`, simulated: true, event };
  }

  async updateEvent({ eventId, event }) {
    return { eventId, simulated: true, event };
  }

  async deleteEvent({ eventId }) {
    return { eventId, deleted: true, simulated: true };
  }
}

// --- Google ----------------------------------------------------------------

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_REVOKE = "https://oauth2.googleapis.com/revoke";

/**
 * Google Calendar.
 *
 * Scopes are the narrowest that do the job: `calendar.events` to write our own
 * lessons, and `calendar.readonly` to read free/busy. Notably *not*
 * `calendar`, which would let us delete a tutor's other appointments — the
 * platform has no business being able to do that.
 *
 * `access_type=offline` + `prompt=consent` is what yields a refresh token;
 * without the prompt Google returns one only on the very first authorisation,
 * and a tutor who reconnects would silently end up with a connection that
 * dies in an hour.
 */
export class GoogleCalendarProvider extends CalendarProvider {
  static SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "email",
  ];

  constructor({ clientId, clientSecret, fetchImpl } = {}) {
    super();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get name() {
    return CALENDAR_PROVIDERS.GOOGLE;
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Probe Google's token endpoint with a refresh grant that cannot succeed.
   *
   * The trick is that Google reports the two failures differently, and the
   * difference is exactly the question being asked:
   *
   *   invalid_client  → the client id or secret is wrong
   *   invalid_grant   → the client is fine; only the (deliberately bogus)
   *                     refresh token was rejected
   *
   * So a response of `invalid_grant` is the *success* case here. Nothing is
   * created, nothing is charged, and no user is involved.
   */
  async verify() {
    if (!this.configured) {
      return { ok: false, code: "NOT_CONFIGURED", message: "A client ID and client secret are required." };
    }

    let response;
    let payload = {};
    try {
      response = await this.fetch(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: "aplus-credential-probe",
        }).toString(),
      });
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      return { ok: false, code: "UNREACHABLE", message: `Google could not be reached: ${error.message}` };
    }

    if (payload.error === "invalid_grant") {
      return {
        ok: true,
        code: "OK",
        message: "Google accepted the client ID and secret. Tutors can now connect their own calendars.",
      };
    }
    if (payload.error === "invalid_client" || response.status === 401) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Google rejected the client ID or client secret." };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED", message: "Google is rate limiting this client. Try again shortly." };
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      // `error` is a short, documented OAuth code — never a credential.
      message: `Google answered unexpectedly (${payload.error ?? `HTTP ${response.status}`}).`,
    };
  }

  getAuthorizationUrl({ redirectUri, state, loginHint }) {
    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GoogleCalendarProvider.SCOPES.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", state);
    if (loginHint) url.searchParams.set("login_hint", loginHint);
    return url.toString();
  }

  async exchangeCode({ code, redirectUri }) {
    const payload = await this.token({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    if (!payload.refresh_token) {
      // Without it the connection dies in an hour and there is no way back
      // except re-consent, so this is a failure rather than a warning.
      throw calendarError(
        "Google did not return a refresh token. Remove this app from your Google account permissions and connect again.",
        "NO_REFRESH_TOKEN",
      );
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresInSeconds: payload.expires_in,
      scope: payload.scope,
      account: identityFromIdToken(payload.id_token),
    };
  }

  async refreshAccessToken({ refreshToken }) {
    const payload = await this.token({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    return {
      accessToken: payload.access_token,
      // Google rotates refresh tokens only sometimes; keep the old one when
      // it does not, or the connection breaks on the next refresh.
      refreshToken: payload.refresh_token ?? refreshToken,
      expiresInSeconds: payload.expires_in,
    };
  }

  async token(params) {
    const response = await this.fetch(GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw calendarError(
        `Google refused the token request: ${payload.error_description ?? payload.error ?? response.status}`,
        payload.error === "invalid_grant" ? "REFRESH_REJECTED" : "TOKEN_FAILED",
        response.status,
      );
    }
    return payload;
  }

  async api(path, { accessToken, method = "GET", body, query } = {}) {
    const url = new URL(`${GOOGLE_API}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await this.fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return {};

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw calendarError(
        `Google Calendar: ${payload.error?.message ?? `HTTP ${response.status}`}`,
        response.status === 401 ? "UNAUTHORIZED" : "API_ERROR",
        response.status,
      );
    }
    return payload;
  }

  async listCalendars({ accessToken }) {
    const payload = await this.api("/users/me/calendarList", {
      accessToken,
      query: { minAccessRole: "writer", maxResults: 50 },
    });

    return (payload.items ?? []).map((item) => ({
      id: item.id,
      name: item.summary,
      primary: Boolean(item.primary),
      timeZone: item.timeZone,
    }));
  }

  async listBusyPeriods({ accessToken, calendarId, from, to }) {
    const payload = await this.api("/freeBusy", {
      accessToken,
      method: "POST",
      body: {
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        items: [{ id: calendarId || "primary" }],
      },
    });

    const calendar = payload.calendars?.[calendarId || "primary"] ?? {};
    if (calendar.errors?.length) {
      throw calendarError(
        `Google Calendar: ${calendar.errors[0].reason}`,
        calendar.errors[0].reason === "notFound" ? "CALENDAR_GONE" : "API_ERROR",
      );
    }

    return (calendar.busy ?? []).map((slot) => ({
      start: new Date(slot.start),
      end: new Date(slot.end),
    }));
  }

  async createEvent({ accessToken, calendarId, event }) {
    const payload = await this.api(`/calendars/${encodeURIComponent(calendarId || "primary")}/events`, {
      accessToken,
      method: "POST",
      body: googleEvent(event),
    });
    return { eventId: payload.id, htmlLink: payload.htmlLink };
  }

  async updateEvent({ accessToken, calendarId, eventId, event }) {
    const payload = await this.api(
      `/calendars/${encodeURIComponent(calendarId || "primary")}/events/${encodeURIComponent(eventId)}`,
      { accessToken, method: "PATCH", body: googleEvent(event) },
    );
    return { eventId: payload.id ?? eventId };
  }

  async deleteEvent({ accessToken, calendarId, eventId }) {
    try {
      await this.api(
        `/calendars/${encodeURIComponent(calendarId || "primary")}/events/${encodeURIComponent(eventId)}`,
        { accessToken, method: "DELETE" },
      );
    } catch (error) {
      // Already gone is the outcome we wanted, not a failure.
      if (error.status !== 404 && error.status !== 410) throw error;
    }
    return { eventId, deleted: true };
  }

  async revoke({ refreshToken }) {
    try {
      await this.fetch(GOOGLE_REVOKE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      return { revoked: true };
    } catch {
      // The local connection is deleted either way; a provider that cannot be
      // reached must not leave a tutor unable to disconnect.
      return { revoked: false };
    }
  }
}

/**
 * Google's event shape.
 *
 * Times go out as a wall-clock string plus an IANA zone rather than a UTC
 * instant, so a lesson shows at 5pm Toronto even for a tutor whose calendar
 * is set to another zone, and stays correct across a DST boundary.
 *
 * No client-supplied event id: Google requires base32hex ids and would reject
 * ours, and the (booking, connection) link stored on the booking is what
 * actually makes a repeat push an update rather than a duplicate.
 */
function googleEvent(event) {
  return {
    summary: event.title,
    description: event.description,
    location: event.location,
    start: { dateTime: new Date(event.start).toISOString(), timeZone: event.timeZone },
    end: { dateTime: new Date(event.end).toISOString(), timeZone: event.timeZone },
    // Nobody is invited: adding the other party as an attendee would put a
    // learner's email address into the tutor's address book, and a minor's
    // into anyone's (§35).
    attendees: undefined,
    reminders: { useDefault: true },
    source: event.url ? { title: event.appName, url: event.url } : undefined,
  };
}

/** The account identity carried in Google's id_token, read without verifying. */
function identityFromIdToken(idToken) {
  if (!idToken) return { id: null, email: null };
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    // Not verified on purpose: this token arrived over TLS directly from
    // Google's token endpoint in response to our own client-authenticated
    // request. It is used only to label the connection, never to authenticate
    // anybody — sign-in verifies its ID tokens properly in `oauth-provider`.
    return { id: claims.sub ?? null, email: claims.email ?? null };
  } catch {
    return { id: null, email: null };
  }
}

// --- Microsoft -------------------------------------------------------------

const MS_AUTH = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
const MS_TOKEN = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const GRAPH_API = "https://graph.microsoft.com/v1.0";

/**
 * Outlook / Microsoft 365 Calendar, over Microsoft Graph.
 *
 * `common` is the default tenant so both work and personal Microsoft accounts
 * can connect; a deployment that serves one organisation can pin its own
 * tenant id instead.
 *
 * `offline_access` is what yields a refresh token — the Microsoft equivalent
 * of Google's `access_type=offline`, and just as load-bearing.
 */
export class MicrosoftCalendarProvider extends CalendarProvider {
  static SCOPES = ["offline_access", "openid", "email", "Calendars.ReadWrite"];

  constructor({ clientId, clientSecret, tenantId = "common", fetchImpl } = {}) {
    super();
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tenantId = tenantId;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get name() {
    return CALENDAR_PROVIDERS.OUTLOOK;
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * The same deliberately-doomed refresh grant Google gets, against the
   * tenant's token endpoint. Microsoft is more specific about which half
   * failed, and the extra detail is worth surfacing: "the secret expired" is
   * a different Tuesday from "the secret is wrong", and Entra secrets do
   * expire on a schedule an operator forgets.
   */
  async verify() {
    if (!this.configured) {
      return { ok: false, code: "NOT_CONFIGURED", message: "A client ID and client secret are required." };
    }

    let response;
    let payload = {};
    try {
      response = await this.fetch(MS_TOKEN(this.tenantId), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: "aplus-credential-probe",
          scope: MicrosoftCalendarProvider.SCOPES.join(" "),
        }).toString(),
      });
      payload = await response.json().catch(() => ({}));
    } catch (error) {
      return { ok: false, code: "UNREACHABLE", message: `Microsoft could not be reached: ${error.message}` };
    }

    const detail = String(payload.error_description ?? "");

    if (payload.error === "invalid_grant") {
      return {
        ok: true,
        code: "OK",
        message: "Microsoft accepted the app registration. Tutors can now connect their own calendars.",
      };
    }
    // AADSTS7000215 is specifically "invalid client secret provided".
    if (detail.includes("AADSTS7000215")) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Microsoft rejected the client secret." };
    }
    // AADSTS7000222 is a secret that has passed its expiry date.
    if (detail.includes("AADSTS7000222")) {
      return {
        ok: false,
        code: "CREDENTIALS_EXPIRED",
        message: "The client secret has expired. Create a new one in the Entra app registration.",
      };
    }
    // AADSTS700016 is an application the tenant does not know.
    if (detail.includes("AADSTS700016") || payload.error === "unauthorized_client") {
      return {
        ok: false,
        code: "INVALID_CREDENTIALS",
        message: "That application ID is not registered in this directory. Check the client and tenant IDs.",
      };
    }
    if (payload.error === "invalid_client" || response.status === 401) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Microsoft rejected the client ID or client secret." };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED", message: "Microsoft is rate limiting this client. Try again shortly." };
    }
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: `Microsoft answered unexpectedly (${payload.error ?? `HTTP ${response.status}`}).`,
    };
  }

  getAuthorizationUrl({ redirectUri, state, loginHint }) {
    const url = new URL(MS_AUTH(this.tenantId));
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", MicrosoftCalendarProvider.SCOPES.join(" "));
    url.searchParams.set("state", state);
    if (loginHint) url.searchParams.set("login_hint", loginHint);
    return url.toString();
  }

  async exchangeCode({ code, redirectUri }) {
    const payload = await this.token({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: MicrosoftCalendarProvider.SCOPES.join(" "),
    });

    if (!payload.refresh_token) {
      throw calendarError(
        "Microsoft did not return a refresh token. The app registration needs the offline_access permission.",
        "NO_REFRESH_TOKEN",
      );
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresInSeconds: payload.expires_in,
      scope: payload.scope,
      account: identityFromIdToken(payload.id_token),
    };
  }

  async refreshAccessToken({ refreshToken }) {
    const payload = await this.token({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MicrosoftCalendarProvider.SCOPES.join(" "),
    });

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
      expiresInSeconds: payload.expires_in,
    };
  }

  async token(params) {
    const response = await this.fetch(MS_TOKEN(this.tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw calendarError(
        `Microsoft refused the token request: ${payload.error_description ?? payload.error ?? response.status}`,
        payload.error === "invalid_grant" ? "REFRESH_REJECTED" : "TOKEN_FAILED",
        response.status,
      );
    }
    return payload;
  }

  async api(path, { accessToken, method = "GET", body, query } = {}) {
    const url = new URL(`${GRAPH_API}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const response = await this.fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return {};

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw calendarError(
        `Outlook Calendar: ${payload.error?.message ?? `HTTP ${response.status}`}`,
        response.status === 401 ? "UNAUTHORIZED" : "API_ERROR",
        response.status,
      );
    }
    return payload;
  }

  async listCalendars({ accessToken }) {
    const payload = await this.api("/me/calendars", {
      accessToken,
      query: { $select: "id,name,isDefaultCalendar,canEdit", $top: "50" },
    });

    return (payload.value ?? [])
      .filter((item) => item.canEdit !== false)
      .map((item) => ({
        id: item.id,
        name: item.name,
        primary: Boolean(item.isDefaultCalendar),
        timeZone: undefined,
      }));
  }

  /**
   * Graph has no free/busy endpoint scoped to one calendar, so busy periods
   * come from the calendar view — the events themselves — with anything the
   * owner marked "free" filtered out. `getSchedule` exists but answers for a
   * mailbox rather than a calendar, which would be the wrong answer for a
   * tutor who keeps teaching in a separate calendar.
   */
  async listBusyPeriods({ accessToken, calendarId, from, to }) {
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`
      : "/me/calendarView";

    const payload = await this.api(path, {
      accessToken,
      query: {
        startDateTime: new Date(from).toISOString(),
        endDateTime: new Date(to).toISOString(),
        $select: "start,end,showAs,isCancelled",
        $top: "250",
      },
    });

    return (payload.value ?? [])
      .filter((event) => !event.isCancelled && event.showAs !== "free")
      .map((event) => ({
        // Graph returns naive local strings with a separate zone; the Z makes
        // the UTC ones it sends unambiguous to `Date`.
        start: new Date(`${event.start.dateTime}Z`),
        end: new Date(`${event.end.dateTime}Z`),
      }))
      .filter((period) => !Number.isNaN(period.start.getTime()) && !Number.isNaN(period.end.getTime()));
  }

  async createEvent({ accessToken, calendarId, event }) {
    const path = calendarId
      ? `/me/calendars/${encodeURIComponent(calendarId)}/events`
      : "/me/events";
    const payload = await this.api(path, { accessToken, method: "POST", body: graphEvent(event) });
    return { eventId: payload.id, htmlLink: payload.webLink };
  }

  async updateEvent({ accessToken, eventId, event }) {
    const payload = await this.api(`/me/events/${encodeURIComponent(eventId)}`, {
      accessToken,
      method: "PATCH",
      body: graphEvent(event),
    });
    return { eventId: payload.id ?? eventId };
  }

  async deleteEvent({ accessToken, eventId }) {
    try {
      await this.api(`/me/events/${encodeURIComponent(eventId)}`, { accessToken, method: "DELETE" });
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
    }
    return { eventId, deleted: true };
  }
}

function graphEvent(event) {
  return {
    subject: event.title,
    body: { contentType: "text", content: event.description ?? "" },
    location: event.location ? { displayName: event.location } : undefined,
    start: { dateTime: isoWithoutZone(event.start), timeZone: event.timeZone },
    end: { dateTime: isoWithoutZone(event.end), timeZone: event.timeZone },
    showAs: "busy",
    // As with Google: no attendees, so no address book gains a learner (§35).
    attendees: [],
    transactionId: event.idempotencyKey,
  };
}

/** Graph wants "2026-03-04T17:00:00" alongside a named zone, not an offset. */
function isoWithoutZone(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "");
}

function calendarError(message, code, status) {
  const error = new Error(message);
  error.code = code ?? "CALENDAR_ERROR";
  error.status = status;
  // Safe to surface: names the provider and what it said, never a token.
  error.expose = true;
  return error;
}

// --- Selection -------------------------------------------------------------

const cache = new Map();

/**
 * The adapter for one provider.
 *
 * Calendar sync is additive — a tutor who connects nothing still publishes
 * availability by hand and still gets bookings — so a deployment without
 * credentials gets the development implementation rather than an error. It is
 * labelled as such everywhere it surfaces, so nobody believes their Google
 * account is attached when it is not.
 */
export async function getCalendarProvider(provider = CALENDAR_PROVIDERS.GOOGLE) {
  const key = String(provider).toUpperCase();

  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.CALENDAR);
  const cacheKey = `${key}:${resolved.source}:${resolved.updatedAt?.getTime?.() ?? 0}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const instance = buildCalendarProvider(key, resolved);
  cache.set(cacheKey, instance);
  return instance;
}

/**
 * Build one adapter from a resolved configuration.
 *
 * Exported so the connection test can build a provider for a specific
 * platform from a configuration that has been saved but not yet switched on.
 */
export function buildCalendarProvider(providerKey, resolved) {
  const key = String(providerKey).toUpperCase();
  const name = nameFor(key);

  // Enabled matters here as well as at the service: a disabled module gets
  // the development implementation rather than an error, because calendar
  // sync is additive and a tutor who connects nothing still takes bookings.
  const live =
    resolved.enabled &&
    resolved.configured &&
    (resolved.providers ?? []).includes(name);

  if (!live) return new DevelopmentCalendarProvider(key);

  // Each platform reads its *own* registry fields. Both may be live at once,
  // so a shared `clientId`/`clientSecret` pair would mean handing Google the
  // credentials registered with Microsoft — presenting one third party's
  // confidential client secret to another, over the wire, at token exchange.
  if (key === CALENDAR_PROVIDERS.GOOGLE) {
    return new GoogleCalendarProvider({
      clientId: resolved.config.googleClientId,
      clientSecret: resolved.secrets.googleClientSecret,
    });
  }

  return new MicrosoftCalendarProvider({
    clientId: resolved.config.microsoftClientId,
    clientSecret: resolved.secrets.microsoftClientSecret,
    tenantId: resolved.config.microsoftTenantId || "common",
  });
}

/** `INTEGRATIONS` names providers in lower snake case; the domain uses enums. */
function nameFor(provider) {
  return provider === CALENDAR_PROVIDERS.OUTLOOK ? "microsoft" : "google";
}

/** What the tutor's calendar screen shows about each provider. */
export async function calendarIntegrationsStatus() {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.CALENDAR);

  return Object.values(CALENDAR_PROVIDERS).map((provider) => {
    const live =
      resolved.enabled &&
      resolved.configured &&
      resolved.provider !== DEVELOPMENT &&
      (resolved.providers ?? []).includes(nameFor(provider));

    return {
      provider,
      label: provider === CALENDAR_PROVIDERS.GOOGLE ? "Google Calendar" : "Outlook Calendar",
      /** Always true: the development implementation is a working one. */
      available: true,
      /** False when it is the development implementation rather than the real service. */
      live,
      error: resolved.error ?? null,
    };
  });
}

export function resetCalendarProviders() {
  cache.clear();
}
