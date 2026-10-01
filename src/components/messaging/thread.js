/**
 * How a conversation's message list is put together in the browser
 * (§21, docs/REALTIME.md).
 *
 * Three things can deliver the same message: the response to its own send,
 * a catch-up read after a realtime hint, and a fresh server render. They race
 * — the hint for your own message can beat the response to it — so the list
 * is never appended to, only *merged*:
 *
 *   - A stored message is keyed by its id. Seeing it twice changes nothing.
 *   - A message this browser is still sending (`local`) is keyed by its
 *     `clientId`, the idempotency key the server stores beside it. The moment
 *     any of the three sources brings back a stored message with that
 *     `clientId`, the local one is gone — whichever arrived first.
 *
 * Pure, with no imports, so the integration suite can hold it to that.
 */

/** A v4 UUID. `randomUUID` needs a secure context; a phone on the LAN is not one. */
export function newClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function byTime(a, b) {
  const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (diff) return diff;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

/**
 * `current` with `incoming` stored messages folded in: stored messages unique
 * by id and in time order, then whatever is still local and has not landed.
 */
export function mergeMessages(current, incoming = []) {
  const stored = new Map();
  for (const message of current) if (!message.local) stored.set(String(message.id), message);
  for (const message of incoming) stored.set(String(message.id), message);

  const landed = new Set();
  for (const message of stored.values()) if (message.clientId) landed.add(message.clientId);

  const pending = current.filter((message) => message.local && !landed.has(message.clientId));
  return [...[...stored.values()].sort(byTime), ...pending];
}

/** The newest stored message's time, which is where a catch-up read starts. */
export function newestStoredAt(messages) {
  let newest = null;
  for (const message of messages) {
    if (message.local) continue;
    const at = new Date(message.createdAt).getTime();
    if (newest === null || at > newest) newest = at;
  }
  return newest;
}
