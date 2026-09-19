import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireIntegration, resolveIntegration, DEVELOPMENT } from "@/lib/config/env";

/**
 * SMS abstraction (§38, §41 Phase 2).
 *
 *   ConsoleSmsProvider — development. Prints the message and reports that it
 *                        was *simulated*. It never returns `delivered: true`,
 *                        because nothing was delivered: a development
 *                        deployment that quietly claimed otherwise would hide
 *                        exactly the failure this channel is most likely to
 *                        have in production.
 *   TwilioSmsProvider  — production delivery over Twilio's REST API.
 *
 * Twilio is a `fetch` call rather than the SDK, for the same reason Resend is:
 * the surface used is one form-encoded POST, and the dependency list should
 * not grow for it. Swapping in another carrier means one class and one entry
 * in `INTEGRATIONS`.
 *
 * Nothing here decides *whether* a person should be texted. Consent,
 * preferences, verification and rate limits all live in `sms.service`, so a
 * provider can never be the thing that forgets to check them.
 */

export class SmsProvider {
  get name() {
    throw new Error("not implemented");
  }

  /**
   * @param {{ to: string, body: string, idempotencyKey?: string }} message
   * @returns {Promise<{ delivered: boolean, simulated?: boolean, provider: string,
   *                     messageId: string|null, status: string }>}
   */
  async send() {
    throw new Error("not implemented");
  }
}

export class ConsoleSmsProvider extends SmsProvider {
  get name() {
    return "CONSOLE";
  }

  get configured() {
    return false;
  }

  async send({ to, body }) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        [
          "",
          "──────────────── 📱 simulated SMS (no provider configured) ────────────────",
          `To:   ${to}`,
          `Body: ${body}`,
          "This message was NOT sent to a carrier.",
          "───────────────────────────────────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    }

    return {
      delivered: false,
      simulated: true,
      provider: this.name,
      messageId: null,
      status: "SIMULATED",
    };
  }
}

const TWILIO_API = "https://api.twilio.com/2010-04-01";

/**
 * Twilio.
 *
 * Either a `from` number or a messaging-service SID identifies the sender;
 * Twilio accepts one or the other, and the factory refuses a configuration
 * that has neither rather than letting every send fail at the carrier.
 */
export class TwilioSmsProvider extends SmsProvider {
  constructor({ accountSid, authToken, from, messagingServiceSid, statusCallbackUrl, fetchImpl } = {}) {
    super();
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.from = from;
    this.messagingServiceSid = messagingServiceSid;
    this.statusCallbackUrl = statusCallbackUrl;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get name() {
    return "TWILIO";
  }

  get configured() {
    return Boolean(this.accountSid && this.authToken && (this.from || this.messagingServiceSid));
  }

  async send({ to, body, idempotencyKey }) {
    const params = new URLSearchParams({ To: to, Body: body });
    if (this.messagingServiceSid) params.set("MessagingServiceSid", this.messagingServiceSid);
    else params.set("From", this.from);
    if (this.statusCallbackUrl) params.set("StatusCallback", this.statusCallbackUrl);

    const response = await this.fetch(
      `${TWILIO_API}/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // Twilio de-duplicates on this within a short window, which is a
          // second line of defence behind our own dedupe key.
          ...(idempotencyKey ? { "I-Twilio-Idempotency-Token": idempotencyKey } : {}),
        },
        body: params.toString(),
      },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // The provider's reason and code, never the message body: a text can
      // carry a lesson address or a one-time code (§36).
      const error = new Error(`Twilio rejected the message: ${payload?.message ?? `HTTP ${response.status}`}`);
      error.code = payload?.code ? `TWILIO_${payload.code}` : "SMS_DELIVERY_FAILED";
      error.status = response.status;
      // 4xx other than 429 means this message will never work; retrying it
      // would only burn the same credit again.
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }

    return {
      delivered: true,
      provider: this.name,
      messageId: payload.sid ?? null,
      status: payload.status ?? "queued",
      segments: Number(payload.num_segments) || undefined,
    };
  }
}

/**
 * Verify an inbound Twilio callback (§36).
 *
 * Twilio signs `URL + each POST field appended in key order` with the account
 * auth token. An unsigned or mis-signed request is refused outright: without
 * this, anyone who knows the endpoint could opt an arbitrary number out of
 * notifications, or opt one back in.
 *
 * Exported for the route and for tests, which sign with the real scheme
 * rather than mocking the check away.
 */
export function verifyTwilioSignature({ signature, url, params, authToken }) {
  if (!signature || !authToken) return false;

  const payload = Object.keys(params ?? {})
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const expected = createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  // Length differs -> not equal, and `timingSafeEqual` would throw on it.
  return a.length === b.length && timingSafeEqual(a, b);
}

let cached = null;

export function getSmsProvider() {
  const { name } = requireIntegration("sms");
  if (cached?.key === name) return cached.provider;

  let provider;
  if (name === "twilio") {
    provider = new TwilioSmsProvider({
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      from: process.env.TWILIO_FROM_NUMBER,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL,
    });

    // Twilio's two sender styles are both optional individually and required
    // together, which `INTEGRATIONS` cannot express — so it is checked here,
    // at the first use, rather than failing once per message at the carrier.
    if (!provider.configured) {
      const error = new Error(
        "SMS: SMS_PROVIDER=twilio needs either TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.",
      );
      error.status = 503;
      error.code = "PROVIDER_MISCONFIGURED";
      error.expose = true;
      throw error;
    }
  } else {
    provider = new ConsoleSmsProvider();
  }

  cached = { key: name, provider };
  return provider;
}

/** True when texts actually reach a carrier on this deployment. */
export function smsConfigured() {
  const resolved = resolveIntegration("sms");
  return resolved.configured && resolved.name !== DEVELOPMENT;
}

export function resetSmsProvider() {
  cached = null;
}
