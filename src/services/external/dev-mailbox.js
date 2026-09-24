import "server-only";
import { randomUUID } from "node:crypto";
import { isProduction } from "@/lib/config/env";

/**
 * The development mailbox (§38).
 *
 * With no mail server configured, `ConsoleEmailProvider` prints every message
 * to the server log. That is enough for a person reading a terminal and not
 * enough for anything else: a test driving the forgot-password screen over
 * HTTP, or a browser running an end-to-end journey, has no terminal to read.
 * So the console transport also keeps the last few messages here, and
 * `/dev/mail` shows them.
 *
 * What it holds is exactly what production would have delivered — the real
 * code, the real link. Nothing about the flows that send mail changes; only
 * where the message ends up does.
 *
 * **It cannot exist in production, by two independent locks.** Nothing is
 * recorded unless the process is a development build (`NODE_ENV`) *and* the
 * deployment says it is not production (`APP_ENV`). A staging deployment
 * built with `next build` fails the first lock even with `APP_ENV=staging`,
 * because a mailbox of password-reset codes reachable from the internet is an
 * account takeover, not a convenience. The reader adds a third lock — the
 * configured transport must actually be the console one — in
 * `developmentMailboxEnabled()`.
 *
 * In memory, on `globalThis`, because it is a scratch pad: it survives hot
 * reloads the way the database connection does, and is gone on restart.
 */

const CAPACITY = 50;

const globalForMailbox = globalThis;
const messages = globalForMailbox.__aplusDevMailbox ?? [];
globalForMailbox.__aplusDevMailbox = messages;

/** Whether this process may keep a development mailbox at all. */
export function devMailboxAllowed() {
  return process.env.NODE_ENV !== "production" && !isProduction();
}

/** Keep a copy of a message the console transport "sent". */
export function recordDevMail({ to, subject, text }) {
  if (!devMailboxAllowed()) return;
  messages.unshift({
    id: randomUUID(),
    to: String(to ?? "").toLowerCase(),
    subject: String(subject ?? ""),
    text: String(text ?? ""),
    sentAt: new Date().toISOString(),
  });
  messages.length = Math.min(messages.length, CAPACITY);
}

/** Newest first, optionally for one recipient. */
export function readDevMail({ to, limit = CAPACITY } = {}) {
  if (!devMailboxAllowed()) return [];
  const recipient = to ? String(to).trim().toLowerCase() : null;
  return messages
    .filter((message) => !recipient || message.to === recipient)
    .slice(0, limit)
    .map((message) => ({ ...message }));
}

/** For the test suites. */
export function clearDevMail() {
  messages.length = 0;
}
