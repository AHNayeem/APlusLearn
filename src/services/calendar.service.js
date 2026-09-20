import "server-only";
import { randomUUID } from "node:crypto";
import { CalendarConnection, TutorProfile, User, Booking } from "@/models";
import {
  CALENDAR_PROVIDERS,
  CALENDAR_CONNECTION_STATUS,
  CALENDAR_EVENT_STATE,
  BOOKING_STATUS,
  AUDIT_ACTIONS,
  INTEGRATION_MODULES,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError } from "@/lib/api/errors";
import { encryptSecret, decryptSecret, signState, verifyState } from "@/lib/security/crypto";
import { envBaseUrl } from "@/lib/config/base-url";
import { resolveIntegrationConfig } from "@/lib/config/integrations";
import { addDays } from "@/lib/utils/time";
import { formatDate, formatTime } from "@/lib/utils/format";
import {
  getCalendarProvider,
  calendarIntegrationsStatus,
} from "./external/calendar-provider";
import { getAppConfig } from "./settings.service";
import { recordAudit } from "./audit.service";

/**
 * External calendar sync (§18, §41 Phase 2).
 *
 * Two jobs, and they are separate on purpose:
 *
 *   **Pulling busy time in.** A tutor's dentist appointment is not in this
 *   platform, and a slot offered over it is a slot that gets cancelled. Busy
 *   periods are cached on the connection and merged into availability
 *   wherever a booking could be made, so the guarantee holds at the booking
 *   check and not only in the picker.
 *
 *   **Pushing lessons out.** A lesson is only useful if it is where the tutor
 *   actually looks. Pushes are idempotent per (booking, connection) and are
 *   always best-effort: a calendar that is down must never stop a lesson
 *   being confirmed, rescheduled or cancelled. Failures are recorded on the
 *   booking and retried by the `calendar-sync` job.
 *
 * Everything provider-specific lives behind `CalendarProvider`. This module
 * knows about tokens, consent and the marketplace; it does not know that
 * Google calls it `freeBusy` and Microsoft calls it a calendar view.
 */

const TOKEN_LABEL = "aplus:calendar-token";
const STATE_LABEL = "aplus:calendar-state";
/** How long a cached set of busy periods is trusted. */
const CACHE_MINUTES = 15;
/** How far ahead busy periods are fetched — the booking horizon plus slack. */
const BUSY_WINDOW_DAYS = 90;
/** Failures in a row before the connection stops being treated as usable. */
const FAILURE_LIMIT = 5;

// --- Reads -----------------------------------------------------------------

/** What a tutor is shown about their own connections. Never any token. */
export function toPublicConnection(connection) {
  if (!connection) return null;
  return {
    id: String(connection._id ?? connection.id),
    provider: connection.provider,
    simulated: Boolean(connection.simulated),
    accountEmail: connection.accountEmail ?? null,
    calendarId: connection.calendarId ?? null,
    calendarName: connection.calendarName ?? null,
    status: connection.status,
    syncBusy: connection.syncBusy,
    pushEvents: connection.pushEvents,
    busyPeriodCount: connection.busyPeriods?.length ?? 0,
    lastSyncedAt: connection.lastSyncedAt ?? null,
    lastSyncError: connection.lastSyncError ?? null,
    connectedAt: connection.connectedAt ?? null,
  };
}

export async function listConnections(userId) {
  const connections = await CalendarConnection.find({
    userId,
    status: { $ne: CALENDAR_CONNECTION_STATUS.REVOKED },
  })
    .sort({ createdAt: 1 })
    .lean();

  return {
    connections: connections.map(toPublicConnection),
    providers: await calendarIntegrationsStatus(),
  };
}

/**
 * Whether calendar work may run at all right now (§39).
 *
 * The module switch has to be checked *here* rather than in the provider
 * factory, because the factory's fall back to the development implementation
 * is load-bearing for a deployment that simply has no Google credentials —
 * and reusing it for "switched off" would mean a disabled module quietly
 * writing simulated events onto tutors' real connections, which is worse than
 * either doing nothing or failing.
 *
 * Existing connections are untouched: a module switched back on resumes where
 * it left off, which is what the panel promises.
 */
async function calendarModuleEnabled() {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.CALENDAR);
  return resolved.enabled;
}

// --- Connecting ------------------------------------------------------------

/**
 * Step one: where to send the tutor to grant access.
 *
 * The `state` is signed and carries the account it was issued for, so the
 * callback can prove the code it receives belongs to the session presenting
 * it. Without that, a code obtained for one account could be redeemed into
 * another's connection (§36).
 */
export async function beginConnection(actor, { provider }) {
  assertKnownProvider(provider);

  const user = await User.findById(actor.id).select("email").lean();
  if (!user) throw new NotFoundError("We couldn't find your account.");

  const state = signState(
    { userId: String(actor.id), provider, nonce: randomUUID() },
    { label: STATE_LABEL },
  );

  const authorizationUrl = (await getCalendarProvider(provider)).getAuthorizationUrl({
    redirectUri: redirectUriFor(provider),
    state,
    loginHint: user.email,
  });

  return { authorizationUrl, provider };
}

/**
 * Step two: redeem the code and store the connection.
 *
 * Re-connecting an account that is already linked updates that row rather
 * than adding a second one — two connections to the same calendar would
 * double every busy period and push every lesson twice.
 */
export async function completeConnection({ code, state }) {
  const claims = verifyState(state, { label: STATE_LABEL });
  if (!claims?.userId || !claims.provider) {
    throw new AuthorizationError("That calendar authorisation could not be verified. Try again.");
  }

  const provider = claims.provider;
  assertKnownProvider(provider);

  const adapter = await getCalendarProvider(provider);
  const user = await User.findById(claims.userId).select("email").lean();
  if (!user) throw new NotFoundError("We couldn't find your account.");

  const result = await adapter.exchangeCode({
    code,
    redirectUri: redirectUriFor(provider),
    userEmail: user.email,
  });

  const tutorProfile = await TutorProfile.findOne({ userId: claims.userId }).select("_id").lean();

  const accountId = result.account?.id ?? `${provider}:${claims.userId}`;
  const now = new Date();

  const connection = await CalendarConnection.findOneAndUpdate(
    { userId: claims.userId, provider, accountId },
    {
      $set: {
        tutorProfileId: tutorProfile?._id,
        accountEmail: result.account?.email ?? user.email,
        simulated: Boolean(result.simulated),
        accessToken: encryptSecret(result.accessToken, TOKEN_LABEL),
        refreshToken: encryptSecret(result.refreshToken, TOKEN_LABEL),
        accessTokenExpiresAt: new Date(now.getTime() + (result.expiresInSeconds ?? 3600) * 1000),
        scope: result.scope,
        status: CALENDAR_CONNECTION_STATUS.CONNECTED,
        consecutiveFailures: 0,
        lastSyncError: null,
        disconnectedAt: null,
        connectedAt: now,
      },
      $setOnInsert: { userId: claims.userId, provider, accountId, syncBusy: true, pushEvents: true },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  // Pick the account's primary calendar so the connection is usable
  // immediately; the tutor can change it afterwards.
  if (!connection.calendarId) {
    const calendars = await withAccessToken(connection, (token) =>
      adapter.listCalendars({ accessToken: token }),
    ).catch(() => []);

    const chosen = calendars.find((c) => c.primary) ?? calendars[0];
    if (chosen) {
      connection.calendarId = chosen.id;
      connection.calendarName = chosen.name;
      connection.calendarTimeZone = chosen.timeZone;
      await connection.save();
    }
  }

  await syncConnection(connection._id).catch((error) => {
    console.warn("[calendar] first sync failed:", error.message);
  });

  await recordAudit({
    actor: { id: claims.userId },
    action: AUDIT_ACTIONS.CALENDAR_CONNECTED,
    entityType: "CalendarConnection",
    entityId: connection._id,
    metadata: { provider, account: result.account?.email, simulated: Boolean(result.simulated) },
  });

  return toPublicConnection(await CalendarConnection.findById(connection._id).lean());
}

/** The calendars a connected account can write to, for the picker. */
export async function listAvailableCalendars(connectionId, actor) {
  const connection = await ownedConnection(connectionId, actor);
  const adapter = await getCalendarProvider(connection.provider);

  const calendars = await withAccessToken(connection, (token) =>
    adapter.listCalendars({ accessToken: token }),
  );
  return { calendars };
}

/**
 * Change which calendar is used, or which directions are enabled.
 *
 * Switching calendars clears the cached busy periods: they described a
 * different calendar, and keeping them would block slots for no reason.
 */
export async function updateConnection(connectionId, patch, actor) {
  const connection = await ownedConnection(connectionId, actor);

  if (patch.calendarId !== undefined && patch.calendarId !== connection.calendarId) {
    const adapter = await getCalendarProvider(connection.provider);
    const calendars = await withAccessToken(connection, (token) =>
      adapter.listCalendars({ accessToken: token }),
    );
    const chosen = calendars.find((c) => c.id === patch.calendarId);
    if (!chosen) {
      throw new NotFoundError("That calendar is not available on the connected account.");
    }

    connection.calendarId = chosen.id;
    connection.calendarName = chosen.name;
    connection.calendarTimeZone = chosen.timeZone;
    connection.busyPeriods = [];
    connection.freshUntil = null;
  }

  if (patch.syncBusy !== undefined) connection.syncBusy = patch.syncBusy;
  if (patch.pushEvents !== undefined) connection.pushEvents = patch.pushEvents;

  await connection.save();
  if (connection.syncBusy) await syncConnection(connection._id).catch(() => {});

  return toPublicConnection(await CalendarConnection.findById(connection._id).lean());
}

/**
 * Disconnect.
 *
 * Three things happen and the order matters: the lessons we put on that
 * calendar are taken off it, the provider is asked to forget us, and only
 * then is the row removed. Doing it the other way round would leave a tutor's
 * calendar full of events from a platform they just disconnected.
 */
export async function disconnectCalendar(connectionId, actor) {
  const connection = await ownedConnection(connectionId, actor);
  const adapter = await getCalendarProvider(connection.provider);

  await removeAllEventsFor(connection).catch((error) => {
    console.warn("[calendar] could not clean up events on disconnect:", error.message);
  });

  const refreshToken = decryptSecret(connection.refreshToken, TOKEN_LABEL);
  if (refreshToken) {
    await adapter.revoke({ refreshToken }).catch(() => ({ revoked: false }));
  }

  await CalendarConnection.deleteOne({ _id: connection._id });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.CALENDAR_DISCONNECTED,
    entityType: "CalendarConnection",
    entityId: connection._id,
    metadata: { provider: connection.provider, account: connection.accountEmail },
  });

  return { disconnected: true };
}

// --- Pulling busy time in --------------------------------------------------

/**
 * Refresh one connection's cached busy periods.
 *
 * Failures are counted rather than thrown: a calendar that is briefly down
 * should not take a tutor's whole availability offline, and a calendar that
 * has been down for a while should stop being consulted rather than quietly
 * returning stale data forever.
 */
export async function syncConnection(connectionId, { now = new Date(), windowDays = BUSY_WINDOW_DAYS } = {}) {
  const connection = await CalendarConnection.findById(connectionId).select(
    "+accessToken +refreshToken +accessTokenExpiresAt +simulatedEvents",
  );
  if (!connection) throw new NotFoundError("That calendar connection no longer exists.");
  if (!connection.syncBusy) return { skipped: "SYNC_DISABLED" };
  if (!(await calendarModuleEnabled())) return { skipped: "MODULE_DISABLED" };

  const adapter = await getCalendarProvider(connection.provider);
  const to = addDays(now, windowDays);

  try {
    const busy = await withAccessToken(connection, (token) =>
      adapter.listBusyPeriods({
        accessToken: token,
        calendarId: connection.calendarId,
        from: now,
        to,
        // Only the development implementation uses this; the real ones ask
        // the provider.
        events: connection.simulatedEvents ?? [],
      }),
    );

    connection.busyPeriods = busy.map((p) => ({ start: p.start, end: p.end }));
    connection.busyWindowEnd = to;
    connection.freshUntil = new Date(now.getTime() + CACHE_MINUTES * 60_000);
    connection.lastSyncedAt = now;
    connection.lastSyncError = null;
    connection.consecutiveFailures = 0;
    connection.status = CALENDAR_CONNECTION_STATUS.CONNECTED;
    await connection.save();

    return { synced: busy.length, provider: connection.provider };
  } catch (error) {
    connection.consecutiveFailures = (connection.consecutiveFailures ?? 0) + 1;
    connection.lastSyncError = String(error.message).slice(0, 300);

    // A rejected refresh token is not a transient failure: the tutor revoked
    // access, or changed their password. Asking them to reconnect is the only
    // thing that fixes it, so the connection says so rather than retrying
    // forever.
    if (error.code === "REFRESH_REJECTED" || error.code === "UNAUTHORIZED") {
      connection.status = CALENDAR_CONNECTION_STATUS.NEEDS_RECONSENT;
    } else if (connection.consecutiveFailures >= FAILURE_LIMIT) {
      connection.status = CALENDAR_CONNECTION_STATUS.NEEDS_RECONSENT;
    }

    // Stale busy periods are worse than none: they block slots the tutor has
    // actually freed up. Once the connection is unusable, they are dropped.
    if (connection.status === CALENDAR_CONNECTION_STATUS.NEEDS_RECONSENT) {
      connection.busyPeriods = [];
      connection.freshUntil = null;
    }

    await connection.save();

    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.CALENDAR_SYNC_FAILED,
      entityType: "CalendarConnection",
      entityId: connection._id,
      metadata: { provider: connection.provider, error: connection.lastSyncError },
    });

    return { failed: true, error: connection.lastSyncError, status: connection.status };
  }
}

/**
 * The busy periods to subtract from a tutor's availability.
 *
 * Reads the cache rather than the provider, and refreshes it when stale — a
 * public availability query must not put a Google API call in the critical
 * path of a page render. A connection that needs re-consent contributes
 * nothing, which errs towards offering a slot rather than hiding one.
 */
export async function externalBusyPeriods(tutorProfileId, { from = new Date(), to } = {}) {
  if (!tutorProfileId) return [];

  const connections = await CalendarConnection.find({
    tutorProfileId,
    syncBusy: true,
    status: CALENDAR_CONNECTION_STATUS.CONNECTED,
  })
    .select("busyPeriods freshUntil busyWindowEnd")
    .lean();

  if (!connections.length) return [];

  const now = new Date();
  const horizon = to ?? addDays(now, BUSY_WINDOW_DAYS);

  const periods = [];
  for (const connection of connections) {
    // Refresh in the background rather than blocking the caller: a slightly
    // stale calendar is a better outcome than a slow page, and the next
    // request gets the fresh copy.
    if (!connection.freshUntil || connection.freshUntil < now) {
      syncConnection(connection._id).catch(() => {});
    }
    for (const period of connection.busyPeriods ?? []) {
      if (new Date(period.end) <= from || new Date(period.start) >= horizon) continue;
      periods.push({ startAt: period.start, endAt: period.end });
    }
  }

  return periods;
}

/** The scheduled sweep: refresh every connection whose cache has aged out. */
export async function syncStaleCalendars({ now = new Date(), limit = 100 } = {}) {
  const due = await CalendarConnection.find({
    status: CALENDAR_CONNECTION_STATUS.CONNECTED,
    syncBusy: true,
    $or: [{ freshUntil: null }, { freshUntil: { $lt: now } }],
  })
    .select("_id")
    .limit(limit)
    .lean();

  let synced = 0;
  let failed = 0;
  for (const row of due) {
    const result = await syncConnection(row._id, { now }).catch(() => ({ failed: true }));
    if (result.failed) failed += 1;
    else synced += 1;
  }

  const retried = await retryFailedEventPushes({ limit });

  return { examined: due.length, synced, failed, ...retried };
}

// --- Pushing lessons out ---------------------------------------------------

/**
 * Put a lesson on every calendar the tutor asked us to write to.
 *
 * Idempotent per (booking, connection): an existing link is updated rather
 * than a second event created, so a retried webhook or a replayed job cannot
 * double-book a tutor's own week.
 *
 * Never throws. A lesson is confirmed whether or not a calendar accepted it,
 * and a failure is recorded on the booking for the sync job to retry.
 */
export async function pushBookingEvent(bookingOrId) {
  const booking = await loadBooking(bookingOrId);
  if (!booking) return { pushed: 0 };
  if (booking.status !== BOOKING_STATUS.CONFIRMED) return { pushed: 0, skipped: "NOT_CONFIRMED" };
  if (!(await calendarModuleEnabled())) return { pushed: 0, skipped: "MODULE_DISABLED" };

  const connections = await writableConnectionsFor(booking.tutorProfileId);
  if (!connections.length) return { pushed: 0 };

  const config = await getAppConfig().catch(() => null);
  const event = eventForBooking(booking, config?.branding?.appName ?? "APlus Learn");

  let pushed = 0;
  for (const connection of connections) {
    const existing = booking.externalEvents?.find(
      (link) => String(link.connectionId) === String(connection._id),
    );
    const adapter = await getCalendarProvider(connection.provider);

    // Stable per booking per connection: if our own link is lost but the
    // provider supports it, the provider still recognises the repeat.
    const scoped = { ...event, idempotencyKey: `apl-${booking._id}-${connection._id}` };

    try {
      const result = existing?.eventId
        ? await withAccessToken(connection, (token) =>
            adapter.updateEvent({
              accessToken: token,
              calendarId: connection.calendarId,
              eventId: existing.eventId,
              event: scoped,
            }),
          )
        : await withAccessToken(connection, (token) =>
            adapter.createEvent({
              accessToken: token,
              calendarId: connection.calendarId,
              event: scoped,
            }),
          );

      await rememberSimulatedEvent(connection, adapter, result, event);
      await writeEventLink(booking._id, connection, {
        eventId: result.eventId,
        state: CALENDAR_EVENT_STATE.SYNCED,
        syncedAt: new Date(),
        error: null,
      });
      pushed += 1;
    } catch (error) {
      console.warn(`[calendar] could not push booking ${booking.reference}:`, error.message);
      await writeEventLink(booking._id, connection, {
        eventId: existing?.eventId,
        state: CALENDAR_EVENT_STATE.FAILED,
        error: String(error.message).slice(0, 300),
      });
    }
  }

  // A lesson newly on the calendar is busy time the cache does not know about.
  await invalidateBusyCache(booking.tutorProfileId);

  return { pushed };
}

/** A moved lesson updates its event in place rather than making a new one. */
export const updateBookingEvent = pushBookingEvent;

/** Take a cancelled lesson off the calendars it was written to. */
export async function removeBookingEvent(bookingOrId) {
  const booking = await loadBooking(bookingOrId);
  if (!booking?.externalEvents?.length) return { removed: 0 };

  const connections = await CalendarConnection.find({
    _id: { $in: booking.externalEvents.map((link) => link.connectionId) },
  }).select("+accessToken +refreshToken +accessTokenExpiresAt +simulatedEvents");

  let removed = 0;
  for (const connection of connections) {
    const link = booking.externalEvents.find(
      (l) => String(l.connectionId) === String(connection._id),
    );
    if (!link?.eventId || link.state === CALENDAR_EVENT_STATE.DELETED) continue;

    const adapter = await getCalendarProvider(connection.provider);
    try {
      await withAccessToken(connection, (token) =>
        adapter.deleteEvent({
          accessToken: token,
          calendarId: connection.calendarId,
          eventId: link.eventId,
        }),
      );
      await forgetSimulatedEvent(connection, link.eventId);
      await writeEventLink(booking._id, connection, {
        eventId: link.eventId,
        state: CALENDAR_EVENT_STATE.DELETED,
        syncedAt: new Date(),
        error: null,
      });
      removed += 1;
    } catch (error) {
      console.warn(`[calendar] could not remove event for ${booking.reference}:`, error.message);
      await writeEventLink(booking._id, connection, {
        eventId: link.eventId,
        state: CALENDAR_EVENT_STATE.FAILED,
        error: String(error.message).slice(0, 300),
      });
    }
  }

  await invalidateBusyCache(booking.tutorProfileId);
  return { removed };
}

/** Pushes that failed earlier get another go on the next sweep. */
async function retryFailedEventPushes({ limit = 50 } = {}) {
  const stuck = await Booking.find({
    status: BOOKING_STATUS.CONFIRMED,
    startAt: { $gte: new Date() },
    "externalEvents.state": CALENDAR_EVENT_STATE.FAILED,
  })
    .select("_id")
    .limit(limit)
    .lean();

  let retried = 0;
  for (const row of stuck) {
    const result = await pushBookingEvent(row._id).catch(() => ({ pushed: 0 }));
    if (result.pushed) retried += 1;
  }
  return { retriedPushes: retried, stuckPushes: stuck.length };
}

// --- Internals -------------------------------------------------------------

/**
 * Run `fn` with a live access token, refreshing first when the stored one is
 * about to expire.
 *
 * The margin is a minute: a token that expires mid-request is a token that
 * fails the request. A refreshed token is written back encrypted before it is
 * used, so a crash between refresh and use does not lose it.
 */
async function withAccessToken(connection, fn) {
  const doc = connection.accessToken !== undefined
    ? connection
    : await CalendarConnection.findById(connection._id).select(
        "+accessToken +refreshToken +accessTokenExpiresAt +simulatedEvents",
      );

  let accessToken = decryptSecret(doc.accessToken, TOKEN_LABEL);
  const expiresAt = doc.accessTokenExpiresAt ? new Date(doc.accessTokenExpiresAt) : null;
  const stale = !accessToken || !expiresAt || expiresAt.getTime() - Date.now() < 60_000;

  if (stale) {
    const refreshToken = decryptSecret(doc.refreshToken, TOKEN_LABEL);
    if (!refreshToken) {
      // Either never stored, or encrypted under a rotated AUTH_SECRET. Either
      // way the only fix is a fresh authorisation.
      const error = new Error("This calendar connection needs to be reconnected.");
      error.code = "REFRESH_REJECTED";
      throw error;
    }

    const adapter = await getCalendarProvider(doc.provider);
    const refreshed = await adapter.refreshAccessToken({ refreshToken });

    accessToken = refreshed.accessToken;
    await CalendarConnection.updateOne(
      { _id: doc._id },
      {
        $set: {
          accessToken: encryptSecret(refreshed.accessToken, TOKEN_LABEL),
          refreshToken: encryptSecret(refreshed.refreshToken ?? refreshToken, TOKEN_LABEL),
          accessTokenExpiresAt: new Date(
            Date.now() + (refreshed.expiresInSeconds ?? 3600) * 1000,
          ),
        },
      },
    );
  }

  return fn(accessToken);
}

/** The lesson, as it should read on somebody's calendar. */
function eventForBooking(booking, appName) {
  const lines = [
    `${appName} lesson — ${booking.courseCode ?? booking.courseName}`,
    `Reference ${booking.reference}`,
    booking.meeting?.joinUrl ? `Join: ${booking.meeting.joinUrl}` : null,
    booking.location?.label ? `Location: ${booking.location.label}` : null,
    `Booked through ${appName}. Changes made here are not sent back to ${appName}.`,
  ].filter(Boolean);

  return {
    title: `${booking.courseCode ?? booking.courseName} lesson (${appName})`,
    description: lines.join("\n"),
    location: booking.meeting?.joinUrl ?? booking.location?.label ?? undefined,
    start: booking.startAt,
    end: booking.endAt,
    // The tutor's own zone, so the lesson reads at the hour it was booked for
    // however the tutor's calendar is configured.
    timeZone: booking.timeZone || "America/Toronto",
    appName,
    url: `${envBaseUrl()}/tutor/bookings/${booking._id}`,
  };
}

/** Upsert the (booking, connection) link without disturbing the others. */
async function writeEventLink(bookingId, connection, patch) {
  const updated = await Booking.updateOne(
    { _id: bookingId, "externalEvents.connectionId": connection._id },
    {
      $set: Object.fromEntries(
        Object.entries({ ...patch, provider: connection.provider })
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [`externalEvents.$.${k}`, v]),
      ),
    },
  );

  if (updated.matchedCount) return;

  await Booking.updateOne(
    { _id: bookingId, "externalEvents.connectionId": { $ne: connection._id } },
    { $push: { externalEvents: { connectionId: connection._id, provider: connection.provider, ...patch } } },
  );
}

/** The development implementation keeps its events with the connection. */
async function rememberSimulatedEvent(connection, adapter, result, event) {
  if (!result?.simulated) return;

  await CalendarConnection.updateOne(
    { _id: connection._id, "simulatedEvents.eventId": result.eventId },
    {
      $set: {
        "simulatedEvents.$.title": event.title,
        "simulatedEvents.$.start": event.start,
        "simulatedEvents.$.end": event.end,
        "simulatedEvents.$.timeZone": event.timeZone,
        "simulatedEvents.$.cancelledAt": null,
      },
    },
  ).then(async (res) => {
    if (res.matchedCount) return;
    await CalendarConnection.updateOne(
      { _id: connection._id },
      {
        $push: {
          simulatedEvents: {
            eventId: result.eventId,
            title: event.title,
            start: event.start,
            end: event.end,
            timeZone: event.timeZone,
          },
        },
      },
    );
  });
}

async function forgetSimulatedEvent(connection, eventId) {
  if (!connection.simulated) return;
  await CalendarConnection.updateOne(
    { _id: connection._id },
    { $pull: { simulatedEvents: { eventId } } },
  );
}

/** Connections a lesson may be written to. */
function writableConnectionsFor(tutorProfileId) {
  return CalendarConnection.find({
    tutorProfileId,
    pushEvents: true,
    status: CALENDAR_CONNECTION_STATUS.CONNECTED,
  })
    .select("+accessToken +refreshToken +accessTokenExpiresAt +simulatedEvents")
    .then((rows) => rows ?? []);
}

async function invalidateBusyCache(tutorProfileId) {
  if (!tutorProfileId) return;
  await CalendarConnection.updateMany({ tutorProfileId }, { $set: { freshUntil: null } });
}

function loadBooking(bookingOrId) {
  if (bookingOrId && typeof bookingOrId === "object" && bookingOrId.startAt) {
    return Promise.resolve(bookingOrId);
  }
  return Booking.findById(bookingOrId?._id ?? bookingOrId).lean();
}

async function removeAllEventsFor(connection) {
  const bookings = await Booking.find({ "externalEvents.connectionId": connection._id })
    .select("_id reference externalEvents tutorProfileId")
    .lean();

  for (const booking of bookings) {
    await removeBookingEvent(booking);
  }
}

async function ownedConnection(connectionId, actor) {
  const connection = await CalendarConnection.findById(connectionId).select(
    "+accessToken +refreshToken +accessTokenExpiresAt +simulatedEvents",
  );
  if (!connection) throw new NotFoundError("That calendar connection no longer exists.");

  // Ownership is checked against the loaded record, never against a field in
  // the request (§42).
  if (String(connection.userId) !== String(actor.id)) {
    throw new AuthorizationError("That calendar connection is not yours.");
  }
  return connection;
}

function assertKnownProvider(provider) {
  if (!Object.values(CALENDAR_PROVIDERS).includes(provider)) {
    throw new BusinessRuleError("That calendar provider is not supported.", "UNKNOWN_PROVIDER");
  }
}

function redirectUriFor(provider) {
  return `${envBaseUrl()}/api/calendar/callback/${provider.toLowerCase()}`;
}
