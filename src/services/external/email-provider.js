import "server-only";
import { SITE } from "@/constants/config";
import { requireIntegration } from "@/lib/config/env";
import { emailTemplates } from "./email-templates";

/**
 * Email abstraction (§38).
 *
 *   ConsoleEmailProvider — development. Prints a readable summary so
 *                          verification and reset links are always reachable
 *                          without credentials.
 *   ResendEmailProvider  — production transactional delivery.
 *
 * Resend was chosen over SES/SendGrid/Postmark because it needs nothing but
 * an API key and a verified sending domain: no SDK, no IAM policy, no
 * sub-account model. The interface is one `send()` call, so replacing it is a
 * single class either way.
 *
 * Callers never construct a provider — `getEmailProvider()` decides, and
 * `emailTemplates` supplies both the HTML and plain-text parts.
 */

export class EmailProvider {
  get name() {
    throw new Error("not implemented");
  }
  async send() {
    throw new Error("not implemented");
  }
}

export class ConsoleEmailProvider extends EmailProvider {
  get name() {
    return "CONSOLE";
  }

  async send({ to, subject, text, html }) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        [
          "",
          "──────────── ✉️  APlus Learn email ────────────",
          `To:      ${to}`,
          `Subject: ${subject}`,
          "",
          text ?? stripTags(html ?? ""),
          "───────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    }
    return { delivered: true, provider: this.name, messageId: `console-${Date.now()}` };
  }
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Production transport.
 *
 * Deliberately a `fetch` call rather than the SDK: the whole surface we use
 * is one JSON POST, and keeping it here means the dependency list does not
 * grow for four lines of HTTP.
 */
export class ResendEmailProvider extends EmailProvider {
  constructor({ apiKey, from, replyTo, fetchImpl } = {}) {
    super();
    this.apiKey = apiKey;
    this.from = from;
    this.replyTo = replyTo;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get name() {
    return "RESEND";
  }

  async send({ to, subject, text, html, replyTo, tags }) {
    const response = await this.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Resend de-duplicates on this, so a retried notification cannot
        // send the same message twice.
        "Idempotency-Key": idempotencyKey(to, subject),
      },
      body: JSON.stringify({
        from: this.from,
        to: [to],
        subject,
        text,
        html,
        reply_to: replyTo ?? this.replyTo ?? undefined,
        tags,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Log the provider's reason, never the message body or the recipient's
      // token-bearing links (§36).
      const reason = payload?.message ?? `HTTP ${response.status}`;
      const error = new Error(`Resend rejected the message: ${reason}`);
      error.code = "EMAIL_DELIVERY_FAILED";
      error.status = response.status;
      throw error;
    }

    return { delivered: true, provider: this.name, messageId: payload.id ?? null };
  }
}

/** Stable per-message key: same recipient + subject within the minute. */
function idempotencyKey(to, subject) {
  const minute = Math.floor(Date.now() / 60_000);
  return `aplus-${minute}-${Buffer.from(`${to}:${subject}`).toString("base64url").slice(0, 48)}`;
}

let cached = null;

export function getEmailProvider() {
  const { name } = requireIntegration("email");
  if (cached?.key === name) return cached.provider;

  const provider =
    name === "resend"
      ? new ResendEmailProvider({
          apiKey: process.env.RESEND_API_KEY,
          from: process.env.EMAIL_FROM || `${SITE.name} <no-reply@apluslearn.ca>`,
          replyTo: process.env.EMAIL_REPLY_TO || SITE.supportEmail,
        })
      : new ConsoleEmailProvider();

  cached = { key: name, provider };
  return provider;
}

/**
 * Send, and never let a delivery failure take down the action that triggered
 * it: a booking is still confirmed if the confirmation email bounces.
 *
 * The password-reset path depends on this. It only ever sends for an address
 * that exists, so surfacing a delivery error there would turn the endpoint
 * into an account-enumeration oracle (§36). Pass `critical` only where the
 * caller genuinely cannot proceed without delivery.
 */
export async function sendEmail(message, { critical = false } = {}) {
  try {
    return await getEmailProvider().send(message);
  } catch (error) {
    // The reason, never the body: these messages carry one-time tokens.
    console.error(`[email] delivery failed (${message.subject}):`, error.message);
    if (critical) throw error;
    return { delivered: false, provider: null, error: error.code ?? "EMAIL_DELIVERY_FAILED" };
  }
}

/** Kept on this module so existing call sites import templates unchanged. */
export { emailTemplates };
