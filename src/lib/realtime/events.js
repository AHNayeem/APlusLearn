/**
 * The realtime stream's event names (docs/REALTIME.md).
 *
 * No imports, and deliberately not `server-only`: the hub that sends these and
 * the browser provider that listens for them read the one list.
 */
export const REALTIME_EVENTS = Object.freeze({
  /** First event on every (re)connect: `{ counts }`. The browser reconciles. */
  READY: "ready",
  /** `{ messages, notifications }` — both unread badges. */
  COUNTS: "counts",
  /** `{ id, createdAt }` — a notification was created for this user. */
  NOTIFICATION: "notification",
  /** `{ id, readAt }` — one of this user's notifications changed. */
  NOTIFICATION_UPDATED: "notification.updated",
  /** `{ id, lastMessageAt, lastMessageSenderId, unreadCount, archived, updatedAt }`. */
  CONVERSATION: "conversation",
  /** The server may have missed changes; reconcile from the database. */
  RESYNC: "resync",
  /** Heartbeat, so a stream that has gone silent is noticed. */
  PING: "ping",
  /** `{ reason }` — the server is ending this stream on purpose. */
  BYE: "bye",
});

/** Why the server ended a stream, and whether the browser should come back. */
export const REALTIME_BYE_REASONS = Object.freeze({
  /** The stream reached its lifetime. Reconnect now. */
  LIFETIME: "lifetime",
  /** The session no longer stands. Do not reconnect. */
  UNAUTHORIZED: "unauthorized",
  /** Too many streams for this account; this was the oldest. Wait for the tab to be in view. */
  REPLACED: "replaced",
  /** The server could not start delivering. Back off and retry. */
  UNAVAILABLE: "unavailable",
});
