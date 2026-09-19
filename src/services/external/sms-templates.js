import { NOTIFICATION_TYPES } from "@/constants";

/**
 * Text versions of the notifications worth a text (§28, §41 Phase 2).
 *
 * A notification only gets an SMS if it has a template here. That is the
 * whole opt-in list, and it is short on purpose: a text interrupts, so it is
 * reserved for the things a person needs to act on or would be upset to miss
 * — a lesson changing, a lesson starting, money moving back to them.
 *
 * Marketing, digests and anything an operator might want to "just also send
 * by text" are absent by design. A notification with no template records a
 * SKIPPED row with reason NO_TEMPLATE, so the omission is visible rather than
 * silent.
 *
 * Every body is written to fit one GSM-7 segment (160 characters) once the
 * application name and the STOP footer are added, so a reminder costs one
 * message rather than three.
 */

/** Carrier rules require a standing opt-out path on every message. */
export const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out.";

const TEMPLATES = {
  [NOTIFICATION_TYPES.BOOKING_CONFIRMED]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.BOOKING_CHANGED]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.BOOKING_REMINDER]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.BOOKING_EXPIRED]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.REFUND_ISSUED]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.DISPUTE_UPDATED]: ({ title, body }) => short(title, body),
  [NOTIFICATION_TYPES.APPLICATION_APPROVED]: ({ title }) => title,
  [NOTIFICATION_TYPES.APPLICATION_INFO_REQUESTED]: ({ title }) => title,
};

/** Notification types that may be texted at all. */
export const SMS_NOTIFICATION_TYPES = Object.keys(TEMPLATES);

export function hasSmsTemplate(type) {
  return Boolean(TEMPLATES[type]);
}

/**
 * Render one notification as a text, or null when it is not a texting kind.
 *
 * @param {string} type      A NOTIFICATION_TYPES value.
 * @param {object} payload   `{ title, body }` from the notification record.
 * @param {string} appName   The platform's configured name (§26).
 */
export function smsBodyFor(type, payload, appName) {
  const render = TEMPLATES[type];
  if (!render) return null;

  const core = render(payload ?? {});
  if (!core) return null;

  return `${appName}: ${core} ${SMS_OPT_OUT_FOOTER}`;
}

/** The security code text. Deliberately not in TEMPLATES: it is not a notification. */
export function verificationSmsBody(code, appName) {
  return `${appName}: ${code} is your confirmation code. It expires in 10 minutes. We will never ask you for it.`;
}

/**
 * Title plus as much of the body as fits, cut on a word boundary so a text
 * never ends mid-word.
 *
 * The trailing marker is three ASCII dots rather than a typographic ellipsis
 * on purpose: "…" is outside GSM-7, which forces the *whole* message into
 * UCS-2 and drops the single-segment limit from 160 characters to 70. One
 * prettier character would have made every clipped reminder cost three
 * messages instead of one.
 */
function short(title, body, limit = 110) {
  if (!body) return title;
  const combined = `${title}. ${body}`;
  if (combined.length <= limit) return combined;

  const clipped = combined.slice(0, limit);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : limit).trimEnd()}...`;
}

/** How many segments a body costs, for the delivery log. */
export function segmentCount(body) {
  // GSM-7 fits 160 in a single message and 153 per part once concatenated.
  // Anything outside that alphabet is UCS-2: 70, then 67.
  const unicode = /[^\x20-\x7E\n\r]/.test(body);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}
