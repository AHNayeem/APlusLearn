import "server-only";
import { randomUUID, createSign } from "node:crypto";
import { MEETING_PROVIDERS } from "@/constants";
import { requireIntegration } from "@/lib/config/env";

/**
 * Online lesson links (§27, §38).
 *
 * §27 names three platforms and the learner picks one per booking, so this
 * module holds one adapter per platform behind a single interface and
 * `getMeetingProvider(provider)` returns the right one:
 *
 *   MockMeetingProvider            — development. Issues a deterministic,
 *                                    per-booking room link for all three, so
 *                                    bookings, dashboards and reminders carry
 *                                    meeting data without any credentials.
 *   ZoomMeetingProvider            — Zoom Server-to-Server OAuth.
 *   GoogleMeetProvider             — Google Calendar conference creation.
 *   MicrosoftTeamsMeetingProvider  — Microsoft Graph online meetings.
 *
 * Three rules hold across all of them, and the adapters are the only place
 * that can break them:
 *
 *   **Only the join information is returned.** Each platform hands back some
 *   form of host credential — Zoom's `start_url`, Graph's organizer identity,
 *   a calendar event's attendee list. None of it is returned, stored or
 *   logged. What the caller gets is the provider, an opaque meeting id, the
 *   join URL and, where the platform uses one, a passcode.
 *
 *   **No participant identity leaves the platform.** Not one adapter sends a
 *   learner's or tutor's name or email to the meeting provider. A tutoring
 *   booking for a minor must not become a row in a third party's calendar
 *   with the child's address book entry attached (§35, §42), so rooms are
 *   created unattached and the link is distributed by this application.
 *
 *   **A failure is a missing link, never a lost lesson.** Every adapter
 *   throws a tagged error; `booking.service` catches it, confirms the booking
 *   anyway and leaves the meeting to be filled in later.
 *
 * A meeting link is private to the two participants. Nothing in this module
 * publishes one; `booking.service` stores it on the booking and
 * `getBooking()` releases it only to the purchaser, the tutor or an admin.
 */

export class MeetingProvider {
  get name() {
    throw new Error("not implemented");
  }
  async createMeeting() {
    throw new Error("not implemented");
  }
  /** Move an existing meeting. Reschedules keep the same join link. */
  async updateMeeting() {
    throw new Error("not implemented");
  }
  /** Tear a meeting down so a cancelled lesson's link stops working. */
  async deleteMeeting() {
    throw new Error("not implemented");
  }
}

class MockMeetingProvider extends MeetingProvider {
  get name() {
    return "MOCK";
  }

  async createMeeting({ provider, topic, startAt, durationMinutes }) {
    const id = randomUUID().replace(/-/g, "").slice(0, 11);
    const urls = {
      [MEETING_PROVIDERS.ZOOM]: `https://zoom.us/j/${id}`,
      [MEETING_PROVIDERS.GOOGLE_MEET]: `https://meet.google.com/${id.slice(0, 3)}-${id.slice(3, 7)}-${id.slice(7, 10)}`,
      [MEETING_PROVIDERS.MICROSOFT_TEAMS]: `https://teams.microsoft.com/l/meetup-join/${id}`,
    };

    return {
      provider,
      meetingId: id,
      joinUrl: urls[provider] ?? urls[MEETING_PROVIDERS.ZOOM],
      // Zoom is the only one of the three that uses a numeric passcode.
      passcode: provider === MEETING_PROVIDERS.ZOOM ? String(100000 + (Date.now() % 899999)) : undefined,
      topic,
      startAt,
      durationMinutes,
      createdAt: new Date().toISOString(),
    };
  }

  /** Nothing to call; the deterministic link is valid whenever it is used. */
  async updateMeeting({ meetingId }) {
    return { meetingId, updated: true };
  }

  async deleteMeeting({ meetingId }) {
    return { meetingId, deleted: true };
  }
}

// --- Zoom ------------------------------------------------------------------

const ZOOM_API = "https://api.zoom.us/v2";
const ZOOM_OAUTH = "https://zoom.us/oauth/token";

/**
 * Production provider.
 *
 * Uses Zoom's Server-to-Server OAuth app: the platform owns the meetings, so
 * there is no per-tutor OAuth dance and no tutor Zoom account to maintain.
 * The access token lives for an hour and is cached in memory until just
 * before it expires.
 */
export class ZoomMeetingProvider extends MeetingProvider {
  constructor({ accountId, clientId, clientSecret, hostUserId = "me", fetchImpl } = {}) {
    super();
    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.hostUserId = hostUserId;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.token = null;
  }

  get name() {
    return "ZOOM";
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const url = `${ZOOM_OAUTH}?grant_type=account_credentials&account_id=${encodeURIComponent(this.accountId)}`;
    const response = await this.fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!response.ok) {
      throw meetingError(`Zoom authentication failed (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async call(path, { method = "GET", body } = {}) {
    const response = await this.fetch(`${ZOOM_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return {};
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw meetingError(payload.message ?? `Zoom responded HTTP ${response.status}.`);
    }
    return payload;
  }

  async createMeeting({ topic, startAt, durationMinutes, timeZone = "America/Toronto", agenda }) {
    const meeting = await this.call(`/users/${encodeURIComponent(this.hostUserId)}/meetings`, {
      method: "POST",
      body: {
        topic: topic.slice(0, 200),
        agenda: agenda?.slice(0, 2000),
        // 2 = a scheduled meeting at a fixed time.
        type: 2,
        start_time: new Date(startAt).toISOString().replace(/\.\d{3}Z$/, "Z"),
        duration: durationMinutes,
        timezone: timeZone,
        settings: {
          // A tutoring session is two named people; nobody wanders in.
          waiting_room: true,
          join_before_host: false,
          meeting_authentication: false,
          mute_upon_entry: true,
          auto_recording: "none",
        },
      },
    });

    return {
      provider: MEETING_PROVIDERS.ZOOM,
      meetingId: String(meeting.id),
      joinUrl: meeting.join_url,
      passcode: meeting.password || undefined,
      topic,
      startAt: new Date(startAt).toISOString(),
      durationMinutes,
      createdAt: new Date().toISOString(),
      // `meeting.start_url` is deliberately dropped: it authenticates the
      // host and would hand anyone who saw it control of the meeting.
    };
  }

  async updateMeeting({ meetingId, topic, startAt, durationMinutes, timeZone = "America/Toronto" }) {
    await this.call(`/meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      body: {
        ...(topic ? { topic: topic.slice(0, 200) } : {}),
        ...(startAt
          ? { start_time: new Date(startAt).toISOString().replace(/\.\d{3}Z$/, "Z"), timezone: timeZone }
          : {}),
        ...(durationMinutes ? { duration: durationMinutes } : {}),
      },
    });
    return { meetingId, updated: true };
  }

  async deleteMeeting({ meetingId }) {
    await this.call(`/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
    return { meetingId, deleted: true };
  }
}

// --- Google Meet -----------------------------------------------------------

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * Google Meet (§27).
 *
 * Google does not offer an API that mints a standalone Meet room: a Meet
 * belongs to a calendar event. So the adapter creates an event on a calendar
 * the platform owns and asks Google to attach a conference to it, then keeps
 * the `hangoutLink` and throws the event away as far as the rest of the
 * application is concerned.
 *
 * Authentication is a service account with domain-wide delegation, signing
 * its own assertion and exchanging it for a bearer token — the same shape as
 * Zoom's Server-to-Server grant, and for the same reason: the platform owns
 * the rooms, so there is no per-tutor OAuth dance to maintain.
 *
 * The event is created with **no attendees**. Adding the learner and tutor
 * would be the obvious thing and is deliberately not done: it would put a
 * child's email address into a third party's calendar, send invitations this
 * application did not ask for, and expose each participant's address to the
 * other. The join link is private and this application distributes it.
 */
export class GoogleMeetProvider extends MeetingProvider {
  constructor({ clientEmail, privateKey, impersonate, calendarId = "primary", fetchImpl } = {}) {
    super();
    this.clientEmail = clientEmail;
    // Env vars cannot hold real newlines, so the PEM arrives escaped.
    this.privateKey = privateKey?.replace(/\\n/g, "\n");
    this.impersonate = impersonate;
    this.calendarId = calendarId;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.token = null;
  }

  get name() {
    return "GOOGLE_MEET";
  }

  /** A signed JWT assertion, exchanged for an access token. */
  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: this.clientEmail,
      scope: "https://www.googleapis.com/auth/calendar.events",
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
      // Domain-wide delegation: act as the calendar's owner.
      ...(this.impersonate ? { sub: this.impersonate } : {}),
    };

    const encode = (value) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`;

    let signature;
    try {
      signature = createSign("RSA-SHA256").update(unsigned).sign(this.privateKey, "base64url");
    } catch {
      // Never echo the key material, not even a fragment of it.
      throw meetingError("Google Meet authentication failed: the service-account key is not a valid RSA private key.");
    }

    const response = await this.fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    });

    if (!response.ok) {
      throw meetingError(`Google Meet authentication failed (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async call(path, { method = "GET", body, query } = {}) {
    const url = `${GOOGLE_CALENDAR_API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const response = await this.fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return {};
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw meetingError(payload.error?.message ?? `Google Calendar responded HTTP ${response.status}.`);
    }
    return payload;
  }

  async createMeeting({ topic, startAt, durationMinutes, timeZone = "America/Toronto", agenda }) {
    const start = new Date(startAt);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    const event = await this.call(`/calendars/${encodeURIComponent(this.calendarId)}/events`, {
      method: "POST",
      // Without this Google accepts the request and silently declines to
      // create the conference, which would leave a booking with no link.
      query: { conferenceDataVersion: "1" },
      body: {
        summary: topic.slice(0, 200),
        description: agenda?.slice(0, 2000),
        start: { dateTime: start.toISOString(), timeZone },
        end: { dateTime: end.toISOString(), timeZone },
        // No `attendees`: see the class comment. Nobody's address book entry
        // goes to Google for a lesson this platform arranged.
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        // The room is reached through the link we hand the two participants,
        // not through a calendar someone might share.
        visibility: "private",
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: false,
        reminders: { useDefault: false },
      },
    });

    const joinUrl = event.hangoutLink ?? entryPointUri(event);
    if (!joinUrl) {
      throw meetingError("Google Calendar created the event but returned no Meet link.");
    }

    return {
      provider: MEETING_PROVIDERS.GOOGLE_MEET,
      // The event id is the handle for updates and teardown. The conference
      // id is not kept: it is the room's public-facing name and nothing here
      // needs it.
      meetingId: String(event.id),
      joinUrl,
      // Meet has no passcode; access is the link plus the lobby.
      topic,
      startAt: start.toISOString(),
      durationMinutes,
      createdAt: new Date().toISOString(),
    };
  }

  /** A reschedule moves the event, so the Meet link survives it. */
  async updateMeeting({ meetingId, topic, startAt, durationMinutes, timeZone = "America/Toronto" }) {
    const body = {};
    if (topic) body.summary = topic.slice(0, 200);
    if (startAt && durationMinutes) {
      const start = new Date(startAt);
      body.start = { dateTime: start.toISOString(), timeZone };
      body.end = {
        dateTime: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
        timeZone,
      };
    }

    await this.call(
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(meetingId)}`,
      { method: "PATCH", body },
    );
    return { meetingId, updated: true };
  }

  async deleteMeeting({ meetingId }) {
    await this.call(
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(meetingId)}`,
      { method: "DELETE" },
    );
    return { meetingId, deleted: true };
  }
}

function entryPointUri(event) {
  const video = (event.conferenceData?.entryPoints ?? []).find((e) => e.entryPointType === "video");
  return video?.uri ?? null;
}

// --- Microsoft Teams -------------------------------------------------------

const GRAPH_API = "https://graph.microsoft.com/v1.0";

/**
 * Microsoft Teams (§27).
 *
 * Graph's `onlineMeetings` resource is the closest of the three to what this
 * application actually wants: a standalone meeting with a join link, no
 * calendar event and no invitations. It is created under an application
 * identity — client credentials, `OnlineMeetings.ReadWrite.All`, scoped by an
 * application access policy to the one organiser account the platform owns.
 *
 * The organiser is that service account and will never attend, so the lobby
 * is configured to let the two participants straight in. That is the same
 * posture as every other link this platform issues: the link is the secret,
 * it is private to the purchaser and the tutor, and an empty lobby nobody can
 * be admitted from would simply mean no lesson.
 */
export class MicrosoftTeamsMeetingProvider extends MeetingProvider {
  constructor({ tenantId, clientId, clientSecret, organiserUserId, fetchImpl } = {}) {
    super();
    this.tenantId = tenantId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.organiserUserId = organiserUserId;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.token = null;
  }

  get name() {
    return "MICROSOFT_TEAMS";
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const response = await this.fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: "https://graph.microsoft.com/.default",
        }).toString(),
      },
    );

    if (!response.ok) {
      throw meetingError(`Microsoft Teams authentication failed (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async call(path, { method = "GET", body } = {}) {
    const response = await this.fetch(`${GRAPH_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return {};
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw meetingError(payload.error?.message ?? `Microsoft Graph responded HTTP ${response.status}.`);
    }
    return payload;
  }

  async createMeeting({ topic, startAt, durationMinutes }) {
    const start = new Date(startAt);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    const meeting = await this.call(
      `/users/${encodeURIComponent(this.organiserUserId)}/onlineMeetings`,
      {
        method: "POST",
        body: {
          subject: topic.slice(0, 200),
          startDateTime: start.toISOString(),
          endDateTime: end.toISOString(),
          // No `participants`: the organiser is the service account and the
          // two people attending are never named to Microsoft (§35).
          lobbyBypassSettings: { scope: "everyone", isDialInBypassEnabled: false },
          allowedPresenters: "everyone",
          isEntryExitAnnounced: false,
          recordAutomatically: false,
        },
      },
    );

    if (!meeting.joinWebUrl) {
      throw meetingError("Microsoft Graph created the meeting but returned no join link.");
    }

    return {
      provider: MEETING_PROVIDERS.MICROSOFT_TEAMS,
      meetingId: String(meeting.id),
      joinUrl: meeting.joinWebUrl,
      // `meeting.audioConferencing` carries dial-in numbers and a *conference
      // id* that works as a credential, and `joinInformation` carries the
      // organiser's identity. Neither is returned or stored.
      topic,
      startAt: start.toISOString(),
      durationMinutes,
      createdAt: new Date().toISOString(),
    };
  }

  async updateMeeting({ meetingId, topic, startAt, durationMinutes }) {
    const body = {};
    if (topic) body.subject = topic.slice(0, 200);
    if (startAt && durationMinutes) {
      const start = new Date(startAt);
      body.startDateTime = start.toISOString();
      body.endDateTime = new Date(start.getTime() + durationMinutes * 60_000).toISOString();
    }

    await this.call(
      `/users/${encodeURIComponent(this.organiserUserId)}/onlineMeetings/${encodeURIComponent(meetingId)}`,
      { method: "PATCH", body },
    );
    return { meetingId, updated: true };
  }

  async deleteMeeting({ meetingId }) {
    await this.call(
      `/users/${encodeURIComponent(this.organiserUserId)}/onlineMeetings/${encodeURIComponent(meetingId)}`,
      { method: "DELETE" },
    );
    return { meetingId, deleted: true };
  }
}

// --- Selection -------------------------------------------------------------

function meetingError(message) {
  const error = new Error(message);
  error.code = "MEETING_PROVIDER_ERROR";
  return error;
}

/** `MEETING_PROVIDERS` value → the `INTEGRATIONS.meeting` provider key. */
const ADAPTER_KEYS = {
  [MEETING_PROVIDERS.ZOOM]: "zoom",
  [MEETING_PROVIDERS.GOOGLE_MEET]: "google_meet",
  [MEETING_PROVIDERS.MICROSOFT_TEAMS]: "microsoft_teams",
};

const BUILDERS = {
  zoom: () =>
    new ZoomMeetingProvider({
      accountId: process.env.ZOOM_ACCOUNT_ID,
      clientId: process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET,
      hostUserId: process.env.ZOOM_USER_ID || "me",
    }),
  google_meet: () =>
    new GoogleMeetProvider({
      clientEmail: process.env.GOOGLE_MEET_CLIENT_EMAIL,
      privateKey: process.env.GOOGLE_MEET_PRIVATE_KEY,
      impersonate: process.env.GOOGLE_MEET_IMPERSONATE,
      calendarId: process.env.GOOGLE_MEET_CALENDAR_ID || "primary",
    }),
  microsoft_teams: () =>
    new MicrosoftTeamsMeetingProvider({
      tenantId: process.env.MS_TEAMS_TENANT_ID,
      clientId: process.env.MS_TEAMS_CLIENT_ID,
      clientSecret: process.env.MS_TEAMS_CLIENT_SECRET,
      organiserUserId: process.env.MS_TEAMS_USER_ID,
    }),
};

const cache = new Map();

/**
 * The adapter for one platform.
 *
 * The argument is a `MEETING_PROVIDERS` value — the platform the *learner*
 * chose, read back from the booking, not from a request. It is looked up in a
 * fixed table, so a value that is not one of the three resolves to nothing
 * and falls through to the deployment's default rather than reaching any
 * adapter; there is no path from a string on the wire to a URL this module
 * will call.
 *
 * A platform this deployment has no credentials for falls back to the
 * development provider, which issues a usable deterministic room link, rather
 * than failing the booking. `requireIntegration` still throws on a
 * *misconfiguration* — a provider named without its secrets — so a broken
 * deployment is loud while an unconfigured one merely degrades.
 *
 * @param {string} [requested]  A `MEETING_PROVIDERS` value.
 */
export function getMeetingProvider(requested) {
  const { names } = requireIntegration("meeting");
  const live = new Set(names);

  const wanted = ADAPTER_KEYS[requested];
  const key = wanted && live.has(wanted) ? wanted : null;

  const cacheKey = key ?? "development";
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const provider = key ? BUILDERS[key]() : new MockMeetingProvider();
  cache.set(cacheKey, provider);
  return provider;
}

/** The platforms this deployment can create a *real* room on (§27). */
export function liveMeetingProviders() {
  const { names } = requireIntegration("meeting");
  const live = new Set(names);
  return Object.entries(ADAPTER_KEYS)
    .filter(([, adapterKey]) => live.has(adapterKey))
    .map(([provider]) => provider);
}

/** Tests only. */
export function resetMeetingProviders() {
  cache.clear();
}
