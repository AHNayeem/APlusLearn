import "server-only";
import nodemailer from "nodemailer";
import { SITE } from "@/constants/config";
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_SETTING, INTEGRATION_MODULES } from "@/constants";
import { DEVELOPMENT } from "@/lib/config/env";
import {
  resolveIntegrationConfig,
  requireIntegrationConfig,
  IntegrationDisabledError,
} from "@/lib/config/integrations";
import { getAppConfig } from "@/services/settings.service";
import { emailTemplates, emailTemplatesFor } from "./email-templates";

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
  /**
   * Prove the credentials open the account, without sending anything.
   *
   * Separate from `send()` because an operator checking their configuration
   * should not have to put a message in somebody's inbox to find out it is
   * wrong — and because a key that can send is not the same claim as a key
   * that exists (§39).
   *
   * @returns {Promise<{ ok: boolean, code: string, message: string }>}
   */
  async verify() {
    return { ok: false, code: "NOT_SUPPORTED", message: "This provider cannot be tested." };
  }
}

export class ConsoleEmailProvider extends EmailProvider {
  get name() {
    return "CONSOLE";
  }

  async verify() {
    return {
      ok: true,
      code: "DEVELOPMENT",
      message: "Mail is printed to the server log. Nothing is delivered to a real inbox.",
    };
  }

  async send({ to, subject, text, html }) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        [
          "",
          "──────────────── ✉️  outgoing email ────────────────",
          `To:      ${to}`,
          `Subject: ${subject}`,
          "",
          text ?? stripTags(html ?? ""),
          "────────────────────────────────────────────────────",
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

  /**
   * Ask Resend which domains this key can send from.
   *
   * A cheap, read-only call that distinguishes the three failures an operator
   * actually hits: a key that is wrong (401), a key that is right but has no
   * verified domain behind it (empty list — mail would be accepted and then
   * bounce), and Resend being unreachable.
   */
  async verify() {
    let response;
    try {
      response = await this.fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
    } catch (error) {
      return { ok: false, code: "UNREACHABLE", message: `Resend could not be reached: ${error.message}` };
    }

    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Resend rejected the API key." };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED", message: "Resend is rate limiting this key. Try again shortly." };
    }
    if (!response.ok) {
      return { ok: false, code: "PROVIDER_ERROR", message: `Resend answered HTTP ${response.status}.` };
    }

    const payload = await response.json().catch(() => ({}));
    const domains = payload?.data ?? [];
    const verified = domains.filter((domain) => domain.status === "verified");

    if (!domains.length) {
      return {
        ok: false,
        code: "NO_SENDING_DOMAIN",
        message: "The key works, but no sending domain is set up in Resend. Mail would be rejected.",
      };
    }
    if (!verified.length) {
      return {
        ok: false,
        code: "DOMAIN_UNVERIFIED",
        message: `The key works, but no domain is verified yet (${domains.length} pending). Mail would bounce.`,
      };
    }

    return {
      ok: true,
      code: "OK",
      message: `Connected. ${verified.length} verified sending ${verified.length === 1 ? "domain" : "domains"}.`,
    };
  }
}

/**
 * SMTP, for a deployment that has its own mail server or a relay Resend does
 * not front.
 *
 * `nodemailer` rather than a hand-rolled socket: ESMTP looks small until you
 * meet multi-line greetings, AUTH mechanism negotiation, STARTTLS upgrade
 * races and servers that pipeline. Those are the failures that show up
 * against one customer's Exchange server and nowhere else, which is the worst
 * possible place to discover them.
 *
 * The transport is built per provider instance and reused, because opening a
 * TLS connection and authenticating for every notification would be both slow
 * and a good way to be rate limited by your own mail server.
 */
export class SmtpEmailProvider extends EmailProvider {
  constructor({
    host,
    port,
    secure,
    username,
    password,
    from,
    replyTo,
    rejectUnauthorized = true,
    transport,
  } = {}) {
    super();
    this.host = host;
    this.port = Number(port) || 587;
    this.from = from;
    this.replyTo = replyTo;
    this.transport =
      transport ??
      nodemailer.createTransport({
        host,
        port: this.port,
        // Implicit TLS on 465; everything else starts in the clear and is
        // upgraded with STARTTLS, which nodemailer does automatically.
        secure: secure ?? this.port === 465,
        auth: username ? { user: username, pass: password } : undefined,
        // Off is a real option some self-hosted relays need, but it is the
        // operator's explicit choice and the panel says what it costs.
        tls: { rejectUnauthorized: rejectUnauthorized !== false },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  get name() {
    return "SMTP";
  }

  async verify() {
    try {
      await this.transport.verify();
      return { ok: true, code: "OK", message: `Connected to ${this.host}:${this.port}.` };
    } catch (error) {
      return { ok: false, ...describeSmtpFailure(error) };
    }
  }

  async send({ to, subject, text, html, replyTo }) {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to,
        subject,
        text,
        html,
        replyTo: replyTo ?? this.replyTo ?? undefined,
      });
      return { delivered: true, provider: this.name, messageId: info?.messageId ?? null };
    } catch (cause) {
      const described = describeSmtpFailure(cause);
      const error = new Error(`SMTP rejected the message: ${described.message}`);
      error.code = described.code;
      throw error;
    }
  }
}

/**
 * Turn a nodemailer failure into something an operator can act on.
 *
 * Deliberately does not pass the server's response through verbatim: a
 * rejected AUTH can echo the username, and some servers include the
 * credential they were offered (§36).
 */
function describeSmtpFailure(error) {
  const code = error?.code ?? error?.responseCode ?? "";

  if (code === "EAUTH" || error?.responseCode === 535) {
    return { code: "INVALID_CREDENTIALS", message: "The mail server rejected the username or password." };
  }
  if (code === "ECONNREFUSED") {
    return { code: "UNREACHABLE", message: "The mail server refused the connection. Check the host and port." };
  }
  if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
    return { code: "TIMEOUT", message: "The mail server did not answer in time. Check the host, port and firewall." };
  }
  if (code === "EDNS" || code === "ENOTFOUND") {
    return { code: "UNREACHABLE", message: "That host name does not resolve." };
  }
  if (String(error?.message ?? "").includes("self signed") || String(error?.message ?? "").includes("certificate")) {
    return {
      code: "TLS_ERROR",
      message: "The server's TLS certificate was not accepted. It may be self-signed.",
    };
  }
  return { code: "PROVIDER_ERROR", message: "The mail server refused the connection." };
}

/** Stable per-message key: same recipient + subject within the minute. */
function idempotencyKey(to, subject) {
  const minute = Math.floor(Date.now() / 60_000);
  return `aplus-${minute}-${Buffer.from(`${to}:${subject}`).toString("base64url").slice(0, 48)}`;
}

let cached = null;

/**
 * Build the adapter one resolved configuration describes.
 *
 * Exported so the connection test can build a provider from a configuration
 * *without* going through the cache or the enabled check — testing a module
 * you have just configured but not yet switched on is the normal order of
 * events.
 */
export function buildEmailProvider(resolved) {
  const { provider, config, secrets } = resolved;

  if (provider === "resend") {
    return new ResendEmailProvider({
      apiKey: secrets.apiKey,
      from: config.from || `${SITE.name} <no-reply@apluslearn.ca>`,
      replyTo: config.replyTo || SITE.supportEmail,
    });
  }

  if (provider === "smtp") {
    return new SmtpEmailProvider({
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      password: secrets.password,
      from: config.from || `${SITE.name} <no-reply@apluslearn.ca>`,
      replyTo: config.replyTo || SITE.supportEmail,
      rejectUnauthorized: config.rejectUnauthorized,
    });
  }

  return new ConsoleEmailProvider();
}

/**
 * The configured email transport.
 *
 * Asynchronous because configuration may be stored rather than deployed: an
 * administrator can change the sending account from the admin panel and the
 * next message goes out through it. The resolver memoises for 30 seconds, so
 * this is a map lookup on all but the first send in that window.
 *
 * Throws `IntegrationDisabledError` when an operator has switched email off.
 * `sendEmail()` below turns that into a skip rather than a failure, which is
 * the behaviour every existing caller already expects from a bounced message.
 */
export async function getEmailProvider() {
  const resolved = await requireIntegrationConfig(INTEGRATION_MODULES.EMAIL);

  const key = `${resolved.provider}:${resolved.source}:${resolved.updatedAt?.getTime?.() ?? 0}`;
  if (cached?.key === key) return cached.provider;

  const provider = buildEmailProvider(resolved);
  cached = { key, provider };
  return provider;
}

/** Drop the memoised transport. For tests and for a saved configuration change. */
export function resetEmailProvider() {
  cached = null;
}

/**
 * The template set bound to the platform's configured identity (§26).
 *
 * Services call this instead of importing `emailTemplates` directly, so a
 * renamed application, a new support address or a changed accent colour shows
 * up in the next email without a deployment. Settings are memoised, so this is
 * a map lookup on all but the first call in a 30-second window.
 */
export async function brandedEmailTemplates() {
  const { branding, contact, theme } = await getAppConfig();
  return emailTemplatesFor({
    appName: branding.appName,
    tagline: branding.tagline,
    supportEmail: contact.supportEmail || SITE.supportEmail,
    accentColor: theme.primaryColor,
  });
}

/**
 * Whether a category of mail may be sent right now (§26).
 *
 * `SECURITY` is never consulted against settings and has no switch in the
 * admin panel: verification, password reset and "your password changed" are
 * how an account owner keeps control of their account, and an operator who
 * could silently turn them off could silently lock people out (§36).
 */
export async function emailCategoryEnabled(category) {
  if (!category || category === EMAIL_CATEGORIES.SECURITY) return true;

  try {
    const { notifications } = await getAppConfig();
    if (notifications.emailEnabled === false) return false;

    const key = EMAIL_CATEGORY_SETTING[category];
    return !key || notifications[key] !== false;
  } catch {
    // Unreadable settings must not silence the platform.
    return true;
  }
}

/**
 * Send, and never let a delivery failure take down the action that triggered
 * it: a booking is still confirmed if the confirmation email bounces.
 *
 * The password-reset path depends on this. It only ever sends for an address
 * that exists, so surfacing a delivery error there would turn the endpoint
 * into an account-enumeration oracle (§36). Pass `critical` only where the
 * caller genuinely cannot proceed without delivery.
 *
 * `category` routes the message through the platform notification switches.
 * The check lives here, at the one place every email passes through, so no
 * future call site can accidentally sidestep it.
 */
export async function sendEmail(message, { critical = false, category } = {}) {
  if (!(await emailCategoryEnabled(category))) {
    return { delivered: false, provider: null, skipped: "CATEGORY_DISABLED" };
  }

  try {
    const provider = await getEmailProvider();
    return await provider.send(message);
  } catch (error) {
    // An operator switching the module off is a configuration decision, not a
    // fault: it is reported as a skip with its own reason, the same way a
    // disabled category is, so the delivery log tells the two apart.
    //
    // Security mail *is* affected by this one, unlike the category switches,
    // which exempt it. The module switch is the transport, not a preference —
    // an operator who turns email off has done the same thing as removing the
    // credentials, and pretending a dead transport could still deliver a
    // password reset would be the fake behaviour (§39). The admin panel states
    // the cost before the switch is thrown. A `critical` caller still gets the
    // throw rather than a silent skip.
    if (error?.code === "MODULE_DISABLED") {
      if (critical) throw error;
      return { delivered: false, provider: null, skipped: "MODULE_DISABLED" };
    }

    // The reason, never the body: these messages carry one-time tokens.
    console.error(`[email] delivery failed (${message.subject}):`, error.message);
    if (critical) throw error;
    return { delivered: false, provider: null, error: error.code ?? "EMAIL_DELIVERY_FAILED" };
  }
}

/** Kept on this module so existing call sites import templates unchanged. */
export { emailTemplates };
