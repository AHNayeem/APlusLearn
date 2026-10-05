import "server-only";
import { User } from "@/models";
import { BLOCKED_USER_STATUSES } from "@/constants";
import { connectToDatabase } from "@/lib/db/connect";
import { startSource, configuredSource } from "@/lib/realtime/sources";
import { REALTIME_EVENTS, REALTIME_BYE_REASONS } from "@/lib/realtime/events";
import { unreadMessageCount } from "./message.service";
import { unreadNotificationCount } from "./notification.service";

/**
 * Realtime delivery for messages and notifications (docs/REALTIME.md).
 *
 * A delivery mechanism, never a record. The database is the source of truth:
 * every event here is a *hint* that something a browser is showing has changed,
 * and the browser answers it by reading through the same authorised endpoints
 * it always used. So:
 *
 *   - The stream carries ids, timestamps and counts — never a message body,
 *     a preview or a notification's text.
 *   - Who receives an event is decided from the stored document alone:
 *     `Notification.userId`, `Conversation.participantIds`. Nothing a browser
 *     sends names a channel, so there is nothing to subscribe to that is not
 *     already the caller's own. An administrator gets no events for other
 *     people's threads, even though the moderation tools can open them.
 *   - Losing an event is survivable. Every (re)connect starts with `ready`,
 *     and a source that may have missed something sends `resync`; both make
 *     the browser reconcile from the database.
 *
 * One hub per server process, memoised on `globalThis` like the Mongo
 * connection, so a hot reload in development does not strand a second source.
 */

export { REALTIME_EVENTS };

export const STREAM_TIMING = Object.freeze({
  /** A heartbeat the browser can see, so a silent (buffered) stream is noticed. */
  pingMs: 20_000,
  /** How often a live stream re-checks that its session still stands. */
  sessionCheckMs: 45_000,
  /**
   * A stream ends itself before the platform's `maxDuration` (300 s on the
   * route) would cut it off mid-write; the browser reconnects at once and
   * reconciles, which also bounds how stale a quiet connection can be.
   */
  lifetimeMs: 270_000,
  /** Counts for one user are recomputed at most this often, however busy. */
  countsDebounceMs: 250,
  /** Keep the source running this long after the last subscriber leaves. */
  idleStopMs: 60_000,
});

/** Concurrent streams one account may hold on one server process. */
const MAX_STREAMS_PER_USER = 8;

const hub = (globalThis.__aplusRealtime ??= {
  subscribers: new Map(),
  source: null,
  starting: null,
  idleTimer: null,
  countTimers: new Map(),
});

// --- Routing -------------------------------------------------------------------

function iso(value) {
  return value ? new Date(value).toISOString() : null;
}

/** Who a change is for, and what each of them is told. Ids and times only. */
export function eventsForChange({ collection, op, doc }) {
  if (collection === "notifications") {
    const userId = doc.userId ? String(doc.userId) : null;
    if (!userId) return [];
    const id = String(doc._id);
    return [
      op === "insert"
        ? { userId, event: REALTIME_EVENTS.NOTIFICATION, data: { id, createdAt: iso(doc.createdAt) } }
        : { userId, event: REALTIME_EVENTS.NOTIFICATION_UPDATED, data: { id, readAt: iso(doc.readAt) } },
    ];
  }

  if (collection === "conversations") {
    const id = String(doc._id);
    const unread = doc.unreadCounts ?? {};
    const archived = new Set((doc.archivedBy ?? []).map(String));
    return (doc.participantIds ?? []).map((participant) => {
      const userId = String(participant);
      return {
        userId,
        event: REALTIME_EVENTS.CONVERSATION,
        data: {
          id,
          lastMessageAt: iso(doc.lastMessageAt),
          lastMessageSenderId: doc.lastMessageSenderId ? String(doc.lastMessageSenderId) : null,
          unreadCount: Number(unread[userId] ?? 0),
          archived: archived.has(userId),
          updatedAt: iso(doc.updatedAt),
        },
      };
    });
  }

  return [];
}

function route(record) {
  for (const { userId, event, data } of eventsForChange(record)) {
    const subscribers = hub.subscribers.get(userId);
    if (!subscribers?.size) continue;
    for (const subscriber of subscribers) subscriber.send(event, data);
    scheduleCounts(userId);
  }
}

function resyncAll() {
  for (const subscribers of hub.subscribers.values()) {
    for (const subscriber of subscribers) subscriber.send(REALTIME_EVENTS.RESYNC, {});
  }
}

// Re-pointed on every module evaluation, so a source started before a hot
// reload calls the current code rather than the code it was started with.
hub.route = route;
hub.resync = resyncAll;

/** Both badges, from the same reads the layouts use. */
export async function unreadCounts(userId) {
  const [messages, notifications] = await Promise.all([
    unreadMessageCount(userId),
    unreadNotificationCount(userId),
  ]);
  return { messages, notifications };
}

function scheduleCounts(userId) {
  if (hub.countTimers.has(userId)) return;
  const timer = setTimeout(async () => {
    hub.countTimers.delete(userId);
    const subscribers = hub.subscribers.get(userId);
    if (!subscribers?.size) return;
    try {
      const counts = await unreadCounts(userId);
      for (const subscriber of subscribers) subscriber.send(REALTIME_EVENTS.COUNTS, counts);
    } catch (error) {
      console.error("[realtime] could not recount:", error.message);
    }
  }, STREAM_TIMING.countsDebounceMs);
  hub.countTimers.set(userId, timer);
}

// --- Source lifecycle ------------------------------------------------------------

async function ensureSource() {
  clearTimeout(hub.idleTimer);
  hub.idleTimer = null;
  if (hub.source) return hub.source;
  if (!hub.starting) {
    hub.starting = (async () => {
      const conn = await connectToDatabase();
      const source = await startSource(conn.db, {
        kind: configuredSource(),
        onChange: (record) => hub.route(record),
        onResync: () => hub.resync(),
      });
      hub.source = source;
      return source;
    })().finally(() => {
      hub.starting = null;
    });
  }
  return hub.starting;
}

function stopSourceWhenIdle() {
  if (hub.subscribers.size || hub.idleTimer) return;
  hub.idleTimer = setTimeout(async () => {
    hub.idleTimer = null;
    if (hub.subscribers.size || !hub.source) return;
    const source = hub.source;
    hub.source = null;
    await source.stop().catch(() => {});
  }, STREAM_TIMING.idleStopMs);
}

/** Stop the source now rather than after the idle delay. For tests and shutdown. */
export async function stopRealtime() {
  clearTimeout(hub.idleTimer);
  hub.idleTimer = null;
  for (const timer of hub.countTimers.values()) clearTimeout(timer);
  hub.countTimers.clear();
  const source = hub.source ?? (await hub.starting?.catch(() => null));
  hub.source = null;
  await source?.stop().catch(() => {});
}

/** Which source this process is running, if any. For diagnostics and tests. */
export function realtimeSourceKind() {
  return hub.source?.kind ?? null;
}

/**
 * Register a subscriber: `{ userId, send(event, data), close(reason) }`.
 * Resolves to an unsubscribe function once the source is running.
 */
export async function subscribe(subscriber) {
  const userId = String(subscriber.userId);
  let subscribers = hub.subscribers.get(userId);
  if (!subscribers) {
    subscribers = new Set();
    hub.subscribers.set(userId, subscribers);
  }

  // One account, many tabs and devices — but not without limit. The oldest
  // gives way; its browser reconnects the next time that tab is in view.
  if (subscribers.size >= MAX_STREAMS_PER_USER) {
    const oldest = subscribers.values().next().value;
    subscribers.delete(oldest);
    oldest.close(REALTIME_BYE_REASONS.REPLACED);
  }
  subscribers.add(subscriber);

  try {
    await ensureSource();
  } catch (error) {
    unsubscribe();
    throw error;
  }

  function unsubscribe() {
    const current = hub.subscribers.get(userId);
    if (!current) return;
    current.delete(subscriber);
    if (!current.size) hub.subscribers.delete(userId);
    stopSourceWhenIdle();
  }
  return unsubscribe;
}

// --- Session ---------------------------------------------------------------------

/**
 * Whether the session a stream was opened with still stands.
 *
 * The same rules `getCurrentUser` applies, read fresh: that helper is cached
 * per request, and a stream *is* one long request. A password reset, a forced
 * sign-out, a suspension or a deletion all end the stream within one check.
 */
export async function sessionStillValid(user) {
  const current = await User.findById(user.id).select("status deletedAt tokenVersion").lean();
  if (!current || current.deletedAt) return false;
  if (BLOCKED_USER_STATUSES.includes(current.status)) return false;
  return (current.tokenVersion ?? 0) === (user.tokenVersion ?? 0);
}

// --- The stream ------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Open the event stream for a signed-in user (`GET /api/realtime`).
 *
 * `user` is the record `routeHandler` already authenticated; `signal` is the
 * request's, which aborts when the browser goes away.
 */
export function openRealtimeStream(user, signal) {
  const userId = String(user.id);
  let closed = false;
  let unsubscribe = null;
  const timers = [];
  let controllerRef = null;

  const write = (chunk) => {
    if (closed) return;
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      cleanup();
    }
  };

  const send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  function cleanup() {
    if (closed) return;
    closed = true;
    // `clearTimeout` and `clearInterval` share one id space in Node.
    for (const timer of timers) clearTimeout(timer);
    unsubscribe?.();
    try {
      controllerRef?.close();
    } catch {
      // Already closed by the runtime.
    }
  }

  /** Say why, then end. The browser decides from `reason` whether to come back. */
  const close = (reason) => {
    send(REALTIME_EVENTS.BYE, { reason });
    cleanup();
  };

  const stream = new ReadableStream({
    async start(controller) {
      controllerRef = controller;
      signal?.addEventListener("abort", cleanup, { once: true });

      // A reconnect delay for the browser's own retry, and enough bytes to get
      // past any client that holds a stream back until its first kilobyte.
      write(`retry: 3000\n: ${" ".repeat(2048)}\n\n`);

      const subscriber = { userId, send, close };
      try {
        unsubscribe = await subscribe(subscriber);
      } catch (error) {
        console.error("[realtime] could not start a source:", error.message);
        close(REALTIME_BYE_REASONS.UNAVAILABLE);
        return;
      }
      if (closed) {
        unsubscribe();
        return;
      }

      // Subscribed *before* the snapshot, so a change that lands while the
      // counts are read is delivered afterwards rather than lost between them.
      try {
        send(REALTIME_EVENTS.READY, {
          counts: await unreadCounts(userId),
          ...(process.env.NODE_ENV === "production" ? {} : { source: realtimeSourceKind() }),
        });
      } catch (error) {
        console.error("[realtime] could not read counts:", error.message);
        close(REALTIME_BYE_REASONS.UNAVAILABLE);
        return;
      }

      timers.push(
        setInterval(() => send(REALTIME_EVENTS.PING, {}), STREAM_TIMING.pingMs),
        setInterval(async () => {
          const valid = await sessionStillValid(user).catch(() => true);
          if (!valid) close(REALTIME_BYE_REASONS.UNAUTHORIZED);
        }, STREAM_TIMING.sessionCheckMs),
        setTimeout(() => close(REALTIME_BYE_REASONS.LIFETIME), STREAM_TIMING.lifetimeMs),
      );
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform` is what keeps compression — `next start`'s included —
      // from holding chunks back; `no-store` is the API envelope's rule.
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
