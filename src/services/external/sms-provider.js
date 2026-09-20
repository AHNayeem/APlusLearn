import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { DEVELOPMENT } from "@/lib/config/env";
import { requireIntegrationConfig, resolveIntegrationConfig } from "@/lib/config/integrations";
import { INTEGRATION_MODULES } from "@/constants";

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

  /**
   * Prove the credentials open the account, without sending a message.
   *
   * An operator checking their configuration should not have to text a real
   * phone — and pay for it — to find out the auth token is wrong (§39).
   *
   * @returns {Promise<{ ok: boolean, code: string, message: string }>}
   */
  async verify() {
    return { ok: false, code: "NOT_SUPPORTED", message: "This provider cannot be tested." };
  }
}

export class ConsoleSmsProvider extends SmsProvider {
  get name() {
    return "CONSOLE";
  }

  get configured() {
    return false;
  }

  async verify() {
    return {
      ok: false,
      code: "NO_CARRIER",
      message:
        "No SMS provider is configured, so messages are printed to the server log and never reach a phone.",
    };
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

  /**
   * Fetch the account itself — a read-only call that costs nothing and sends
   * nothing, but proves the SID and auth token belong together.
   *
   * Also reports the account's own status, because a suspended Twilio account
   * accepts credentials happily and then refuses every message, which is a
   * confusing way to find out.
   */
  async verify() {
    if (!this.accountSid || !this.authToken) {
      return { ok: false, code: "NOT_CONFIGURED", message: "An account SID and auth token are required." };
    }

    let response;
    try {
      response = await this.fetch(
        `${TWILIO_API}/Accounts/${encodeURIComponent(this.accountSid)}.json`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          },
        },
      );
    } catch (error) {
      return { ok: false, code: "UNREACHABLE", message: `Twilio could not be reached: ${error.message}` };
    }

    if (response.status === 401) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Twilio rejected the account SID or auth token." };
    }
    if (response.status === 404) {
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Twilio does not recognise that account SID." };
    }
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED", message: "Twilio is rate limiting this account. Try again shortly." };
    }
    if (!response.ok) {
      return { ok: false, code: "PROVIDER_ERROR", message: `Twilio answered HTTP ${response.status}.` };
    }

    const payload = await response.json().catch(() => ({}));
    if (payload.status && payload.status !== "active") {
      return {
        ok: false,
        code: "ACCOUNT_SUSPENDED",
        message: `The credentials are valid, but the Twilio account is ${payload.status}. Messages would be refused.`,
      };
    }

    if (!this.from && !this.messagingServiceSid) {
      return {
        ok: false,
        code: "NO_SENDER",
        message: "The credentials are valid, but no from number or messaging service is set, so nothing can be sent.",
      };
    }

    const sender = this.messagingServiceSid ? "a messaging service" : this.from;
    return {
      ok: true,
      code: "OK",
      message: `Connected to ${payload.friendly_name ?? "the Twilio account"}, sending from ${sender}.`,
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

/**
 * Build the adapter one resolved configuration describes.
 *
 * Exported so a connection test can construct a provider from a configuration
 * that has been saved but not yet switched on.
 */
export function buildSmsProvider(resolved) {
  if (resolved.provider !== "twilio") return new ConsoleSmsProvider();

  return new TwilioSmsProvider({
    accountSid: resolved.config.accountSid,
    authToken: resolved.secrets.authToken,
    from: resolved.config.fromNumber,
    messagingServiceSid: resolved.config.messagingServiceSid,
    statusCallbackUrl: resolved.config.statusCallbackUrl,
  });
}

export async function getSmsProvider() {
  const resolved = await requireIntegrationConfig(INTEGRATION_MODULES.SMS);

  const key = `${resolved.provider}:${resolved.source}:${resolved.updatedAt?.getTime?.() ?? 0}`;
  if (cached?.key === key) return cached.provider;

  const provider = buildSmsProvider(resolved);

  // Twilio's two sender styles are each optional and jointly required, which
  // a per-field required flag cannot express — so it is checked here, at the
  // first use, rather than failing once per message at the carrier.
  if (provider instanceof TwilioSmsProvider && !provider.configured) {
    // Names both the panel field and the environment variable, because
    // either could be where this deployment configures Twilio and an
    // operator should not have to guess which one the message means.
    const error = new Error(
      "SMS: Twilio needs either a from number (TWILIO_FROM_NUMBER) or a messaging service SID (TWILIO_MESSAGING_SERVICE_SID).",
    );
    error.status = 503;
    error.code = "PROVIDER_MISCONFIGURED";
    error.expose = true;
    throw error;
  }

  cached = { key, provider };
  return provider;
}

/** True when texts actually reach a carrier on this deployment. */
export async function smsConfigured() {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.SMS);
  return resolved.enabled && resolved.configured && resolved.provider !== DEVELOPMENT;
}

export function resetSmsProvider() {
  cached = null;
}
