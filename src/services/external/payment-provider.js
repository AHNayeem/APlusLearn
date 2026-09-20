import "server-only";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { DEVELOPMENT } from "@/lib/config/env";
import { requireIntegrationConfig, resolveIntegrationConfig } from "@/lib/config/integrations";
import { AppError } from "@/lib/api/errors";
import { CHECKOUT_HOLD, INTEGRATION_MODULES } from "@/constants";

/**
 * Payment provider abstraction (§20, §38).
 *
 * Two implementations sit behind this interface:
 *
 *   MockPaymentProvider    — development. Money never moves, but every state
 *                            transition a real provider produces is modelled.
 *   StripePaymentProvider  — production. Stripe Checkout for the charge,
 *                            Stripe Connect for tutor payouts.
 *
 * Neither ever receives a price from a browser: `PaymentService` passes the
 * amounts stored on the Booking/Payment documents, which were themselves
 * priced by `lib/booking/pricing`. That separation is the whole point.
 *
 *   PaymentService
 *     ├── createCheckout()
 *     ├── calculateCommission()   <- lib/booking/pricing (always server-side)
 *     ├── processRefund()
 *     └── getPaymentStatus()
 */

export class PaymentProvider {
  get name() {
    throw new Error("not implemented");
  }

  /**
   * True when the provider hosts its own payment page and the card never
   * touches this application. Callers use it to decide between redirecting
   * and rendering the development card form — no caller names a provider.
   */
  get hostedCheckout() {
    return false;
  }

  /** True when a completed payment is only ever confirmed by a webhook. */
  get confirmsByWebhook() {
    return this.hostedCheckout;
  }

  async createCheckout() {
    throw new Error("not implemented");
  }
  async capturePayment() {
    throw new Error("not implemented");
  }
  async getPaymentStatus() {
    throw new Error("not implemented");
  }
  async processRefund() {
    throw new Error("not implemented");
  }
  async createConnectedAccount() {
    throw new Error("not implemented");
  }
  async refreshConnectedAccount() {
    throw new Error("not implemented");
  }
  async createTransfer() {
    throw new Error("not implemented");
  }

  /**
   * Verify and decode a webhook. Implementations must reject anything they
   * cannot prove came from the provider (§36).
   */
  async verifyWebhook() {
    throw new Error("not implemented");
  }

  /**
   * Prove the credentials open the account, and report which mode they are
   * for. Read-only: it never creates a charge, a customer or an account.
   *
   * @returns {Promise<{ ok: boolean, code: string, message: string, livemode?: boolean }>}
   */
  async verify() {
    return { ok: false, code: "NOT_SUPPORTED", message: "This provider cannot be tested." };
  }
}

/**
 * Development provider. Money never moves, but every state transition a real
 * provider produces is modelled, so the app's booking/payout flows are
 * exercised end to end without credentials.
 */
export class MockPaymentProvider extends PaymentProvider {
  get name() {
    return "MOCK";
  }

  /** The development flow keeps checkout in-app, on our own card form. */
  get hostedCheckout() {
    return false;
  }

  async createCheckout({ bookingReference, amountCents, currency = "CAD", metadata = {} }) {
    return {
      provider: this.name,
      checkoutId: `cs_mock_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      paymentIntentId: `pi_mock_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
      amountCents,
      currency,
      // A real provider returns a hosted URL; we keep checkout in-app.
      checkoutUrl: `/bookings/checkout/${bookingReference}`,
      status: "REQUIRES_PAYMENT",
      metadata,
    };
  }

  /**
   * Confirm a payment. The mock accepts any card whose number does not end in
   * the reserved failure suffix, which lets QA exercise the failure path.
   */
  async capturePayment({ paymentIntentId, card = {} }) {
    const number = String(card.number ?? "4242424242424242").replace(/\s/g, "");
    if (number.endsWith("0002")) {
      return {
        status: "FAILED",
        paymentIntentId,
        failureReason: "Your card was declined. Try a different payment method.",
      };
    }
    return {
      status: "PAID",
      paymentIntentId,
      paidAt: new Date().toISOString(),
      paymentMethodBrand: detectBrand(number),
      paymentMethodLast4: number.slice(-4),
      receiptNumber: `RCPT-${Date.now().toString(36).toUpperCase()}`,
    };
  }

  /**
   * There is nothing to read back. The development flow settles in-app, in
   * `capturePayment` above, so the Payment record is already the only and
   * authoritative account of what happened — there is no remote state to
   * reconcile against. Answering "PAID" here would be a fake success: it
   * would tell a caller a payment had gone through without anything having
   * examined a payment. So it refuses instead, and every caller reaches it
   * only through `confirmsByWebhook`, which is false for this provider.
   */
  async getPaymentStatus() {
    throw new AppError(
      "The development payment provider keeps no remote state to read back.",
      { status: 503, code: "NOT_CONFIGURED" },
    );
  }

  async processRefund({ paymentIntentId, amountCents, reason }) {
    return {
      refundId: `re_mock_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
      paymentIntentId,
      amountCents,
      reason,
      status: "SUCCEEDED",
      issuedAt: new Date().toISOString(),
    };
  }

  async createConnectedAccount({ email, country = "CA" }) {
    return {
      accountId: `acct_mock_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      email,
      country,
      onboardingStatus: "IN_PROGRESS",
      onboardingUrl: "/tutor/payouts?onboarding=1",
      payoutsEnabled: false,
      chargesEnabled: false,
      detailsSubmitted: false,
      requirementsDue: ["bank_account", "identity_document"],
    };
  }

  /**
   * The development provider has no hosted onboarding to come back from, so
   * "refresh" is what completes the account. Stripe instead reports whatever
   * the tutor actually finished.
   */
  async refreshConnectedAccount({ accountId }) {
    return {
      accountId,
      onboardingStatus: "COMPLETE",
      payoutsEnabled: true,
      chargesEnabled: true,
      detailsSubmitted: true,
      bankName: "Mock Bank of Canada",
      accountLast4: String(Math.floor(1000 + Math.random() * 8999)),
      requirementsDue: [],
      disabledReason: null,
    };
  }

  async createTransfer({ accountId, amountCents, currency = "CAD" }) {
    return {
      transferId: `tr_mock_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
      accountId,
      amountCents,
      currency,
      status: "PAID",
      arrivedAt: new Date().toISOString(),
    };
  }

  /**
   * The development provider signs nothing, so it can prove nothing. The
   * webhook route refuses unverifiable calls rather than trusting them.
   */
  async verifyWebhook() {
    throw new AppError("Webhooks are not available for the development payment provider.", {
      status: 503,
      code: "NOT_CONFIGURED",
    });
  }

  async verify() {
    return {
      ok: true,
      code: "DEVELOPMENT",
      livemode: false,
      message: "Simulated payments. No money moves and no card is ever charged.",
    };
  }
}

function detectBrand(number) {
  if (/^4/.test(number)) return "Visa";
  if (/^5[1-5]/.test(number)) return "Mastercard";
  if (/^3[47]/.test(number)) return "Amex";
  return "Card";
}

// --- Stripe ----------------------------------------------------------------

/** Pinned so a Stripe-side API release cannot change behaviour underneath us. */
const STRIPE_API_VERSION = "2026-08-26.dahlia";

/**
 * Production provider.
 *
 * Charges run through Stripe Checkout: the card is entered on Stripe's own
 * page and never reaches this application, so the deployment stays outside
 * PCI scope (§35). Payouts use Connect Express with *separate charges and
 * transfers* — the platform takes the whole lesson total, and the tutor's
 * share is transferred later, once the booking has cleared its hold period.
 * That is exactly the model `payout.service` already implements.
 */
export class StripePaymentProvider extends PaymentProvider {
  constructor({ secretKey, webhookSecret, connectWebhookSecret, client } = {}) {
    super();
    this.webhookSecret = webhookSecret;
    this.connectWebhookSecret = connectWebhookSecret;
    // Stripe keys carry their own mode; never infer it from APP_ENV.
    this.livemode = /^(sk|rk)_live_/.test(String(secretKey ?? ""));
    this.stripe =
      client ??
      new Stripe(secretKey, {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: 2,
        appInfo: { name: "APlus Learn", url: "https://apluslearn.ca" },
      });
  }

  get name() {
    return "STRIPE";
  }

  get hostedCheckout() {
    return true;
  }

  /**
   * A hosted Checkout Session for one booking or series.
   *
   * `amountCents` is the server-calculated total. The line item is built from
   * it directly rather than from any client input, and the session is created
   * with an idempotency key so a retried request cannot double-charge.
   */
  async createCheckout({
    bookingReference,
    amountCents,
    currency = "CAD",
    metadata = {},
    description,
    customerEmail,
    customerId,
    successUrl,
    cancelUrl,
    idempotencyKey,
    holdMinutes = CHECKOUT_HOLD.minutes,
  }) {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: currency.toLowerCase(),
              unit_amount: amountCents,
              product_data: {
                name: description || `APlus Learn lesson ${bookingReference}`,
              },
            },
          },
        ],
        client_reference_id: bookingReference,
        ...(customerId ? { customer: customerId } : { customer_email: customerEmail }),
        customer_creation: customerId ? undefined : "always",
        payment_intent_data: {
          description: description || `APlus Learn ${bookingReference}`,
          metadata: sanitiseMetadata(metadata),
        },
        metadata: sanitiseMetadata({ ...metadata, bookingReference }),
        success_url: successUrl,
        cancel_url: cancelUrl,
        // The hosted session and the booking hold expire together, from the
        // same configured window, so the two can never drift apart (§19, §20).
        // Stripe's own bounds are 30 minutes to 24 hours.
        expires_at: Math.floor(Date.now() / 1000) + clampSessionMinutes(holdMinutes) * 60,
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    return {
      provider: this.name,
      checkoutId: session.id,
      paymentIntentId: idOf(session.payment_intent),
      customerId: idOf(session.customer),
      amountCents: session.amount_total ?? amountCents,
      currency: (session.currency ?? currency).toUpperCase(),
      checkoutUrl: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
      status: "REQUIRES_PAYMENT",
      livemode: session.livemode,
      metadata,
    };
  }

  /**
   * Refused by design. Accepting a card number here would put the deployment
   * in PCI scope and would mean trusting a client-reported success; under
   * Stripe the only thing that confirms a booking is the webhook.
   */
  async capturePayment() {
    throw new AppError(
      "Card details are entered on Stripe's payment page. Continue to checkout to complete this payment.",
      { status: 409, code: "HOSTED_CHECKOUT_REQUIRED" },
    );
  }

  /** Authoritative state, read back from Stripe rather than from the client. */
  async getPaymentStatus({ paymentIntentId, checkoutId }) {
    if (paymentIntentId) {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return {
        paymentIntentId: intent.id,
        status: mapIntentStatus(intent.status),
        amountCents: intent.amount_received || intent.amount,
        currency: intent.currency?.toUpperCase(),
        failureReason: intent.last_payment_error?.message ?? null,
      };
    }

    const session = await this.stripe.checkout.sessions.retrieve(checkoutId);
    return {
      checkoutId: session.id,
      paymentIntentId: idOf(session.payment_intent),
      status: session.payment_status === "paid" ? "PAID" : mapSessionStatus(session.status),
      amountCents: session.amount_total,
      currency: session.currency?.toUpperCase(),
    };
  }

  /**
   * Refund `amountCents` — a figure produced by `lib/booking/policy`, never by
   * the caller's own arithmetic. Stripe's `reason` enum is coarse, so the real
   * reason travels in metadata where it stays readable in the dashboard.
   */
  async processRefund({ paymentIntentId, amountCents, reason, idempotencyKey }) {
    const refund = await this.stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        amount: amountCents,
        reason: "requested_by_customer",
        metadata: sanitiseMetadata({ policy: reason ?? "" }),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    return {
      refundId: refund.id,
      paymentIntentId,
      amountCents: refund.amount,
      reason,
      status: refund.status === "succeeded" ? "SUCCEEDED" : refund.status.toUpperCase(),
      issuedAt: new Date((refund.created ?? Date.now() / 1000) * 1000).toISOString(),
    };
  }

  /**
   * Start or resume Connect Express onboarding. Passing an existing
   * `accountId` returns a fresh link for the same account, which is how a
   * tutor continues an interrupted signup.
   */
  async createConnectedAccount({
    email,
    country = "CA",
    accountId,
    returnUrl,
    refreshUrl,
    metadata = {},
  }) {
    const account = accountId
      ? await this.stripe.accounts.retrieve(accountId)
      : await this.stripe.accounts.create({
          type: "express",
          country,
          email,
          business_type: "individual",
          capabilities: { transfers: { requested: true } },
          settings: { payouts: { schedule: { interval: "manual" } } },
          metadata: sanitiseMetadata(metadata),
        });

    const link = await this.stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return { ...describeAccount(account), onboardingUrl: link.url };
  }

  /**
   * Read the account's real state. Unlike the development provider this
   * cannot "complete" anything — only Stripe decides when a tutor's identity
   * and bank details are good enough to receive money.
   */
  async refreshConnectedAccount({ accountId }) {
    const account = await this.stripe.accounts.retrieve(accountId);
    return describeAccount(account);
  }

  /** Move a tutor's settled earnings to their connected account. */
  async createTransfer({ accountId, amountCents, currency = "CAD", metadata = {}, idempotencyKey }) {
    const transfer = await this.stripe.transfers.create(
      {
        destination: accountId,
        amount: amountCents,
        currency: currency.toLowerCase(),
        metadata: sanitiseMetadata(metadata),
      },
      idempotencyKey ? { idempotencyKey } : undefined,
    );

    return {
      transferId: transfer.id,
      accountId,
      amountCents: transfer.amount,
      currency: transfer.currency?.toUpperCase(),
      status: "PAID",
      arrivedAt: new Date((transfer.created ?? Date.now() / 1000) * 1000).toISOString(),
    };
  }

  /**
   * Verify a webhook signature against the raw request body.
   *
   * Connect events arrive on their own endpoint with their own secret, so the
   * caller says which one it is; an event that cannot be verified throws and
   * the route answers 400 without touching the database.
   */
  async verifyWebhook({ payload, signature, connect = false }) {
    const secret = connect ? this.connectWebhookSecret : this.webhookSecret;
    if (!secret) {
      throw new AppError("This webhook endpoint is not configured.", {
        status: 503,
        code: "NOT_CONFIGURED",
      });
    }
    try {
      return await this.stripe.webhooks.constructEventAsync(payload, signature, secret);
    } catch (error) {
      throw new AppError(`Webhook signature verification failed: ${error.message}`, {
        status: 400,
        code: "INVALID_SIGNATURE",
      });
    }
  }

  /**
   * A real, read-only Stripe call — `accounts.retrieve()` for the platform
   * account itself.
   *
   * Chosen over `balance.retrieve()` because it answers two questions at
   * once: the key works, and the account is in a state that can actually take
   * money. It creates nothing, so an operator can press the button as often
   * as they like.
   *
   * The reported `livemode` comes from Stripe's answer rather than from the
   * key prefix, which makes this the one place that can catch a key whose
   * prefix and account disagree.
   */
  async verify() {
    try {
      const account = await this.stripe.accounts.retrieve();
      const mode = this.livemode ? "Live" : "Test";
      const name = account.business_profile?.name || account.email || account.id;

      if (!account.charges_enabled) {
        return {
          ok: false,
          code: "ACCOUNT_RESTRICTED",
          livemode: this.livemode,
          message: `${mode} mode credentials are valid for ${name}, but the account cannot accept charges yet. Finish onboarding in Stripe.`,
        };
      }

      return {
        ok: true,
        code: "OK",
        livemode: this.livemode,
        message: `Connected to ${name} in ${mode.toLowerCase()} mode.`,
      };
    } catch (error) {
      return { ok: false, livemode: this.livemode, ...describeStripeFailure(error) };
    }
  }
}

/**
 * Turn a Stripe error into something an operator can act on, without echoing
 * anything Stripe said back about the credential itself (§36).
 */
function describeStripeFailure(error) {
  const type = error?.type ?? "";

  if (type === "StripeAuthenticationError") {
    return { code: "INVALID_CREDENTIALS", message: "Stripe rejected the secret key." };
  }
  if (type === "StripePermissionError") {
    return {
      code: "INSUFFICIENT_PERMISSIONS",
      message: "The key is valid but is not allowed to read this account. A restricted key may need more scopes.",
    };
  }
  if (type === "StripeRateLimitError") {
    return { code: "RATE_LIMITED", message: "Stripe is rate limiting this key. Try again shortly." };
  }
  if (type === "StripeConnectionError") {
    return { code: "UNREACHABLE", message: "Stripe could not be reached from this server." };
  }
  if (error?.code === "ETIMEDOUT" || type === "StripeAPIError") {
    return { code: "PROVIDER_ERROR", message: "Stripe did not answer. Check status.stripe.com and try again." };
  }
  return { code: "PROVIDER_ERROR", message: "Stripe refused the request." };
}

/** Stripe account -> the provider-agnostic shape PayoutAccount stores. */
function describeAccount(account) {
  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ];
  const complete = Boolean(account.payouts_enabled && account.details_submitted);

  return {
    accountId: account.id,
    email: account.email,
    country: account.country,
    onboardingStatus: complete
      ? "COMPLETE"
      : account.requirements?.disabled_reason
        ? "RESTRICTED"
        : account.details_submitted
          ? "IN_PROGRESS"
          : "IN_PROGRESS",
    payoutsEnabled: Boolean(account.payouts_enabled),
    chargesEnabled: Boolean(account.charges_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    // Display-only, and already masked by Stripe.
    bankName: account.external_accounts?.data?.[0]?.bank_name ?? null,
    accountLast4: account.external_accounts?.data?.[0]?.last4 ?? null,
    requirementsDue: [...new Set(due)],
    disabledReason: account.requirements?.disabled_reason ?? null,
  };
}

function mapIntentStatus(status) {
  if (status === "succeeded") return "PAID";
  if (status === "processing") return "PROCESSING";
  if (status === "canceled") return "CANCELLED";
  return "REQUIRES_PAYMENT";
}

function mapSessionStatus(status) {
  if (status === "complete") return "PROCESSING";
  if (status === "expired") return "CANCELLED";
  return "REQUIRES_PAYMENT";
}

/** Stripe accepts string values only, and metadata is world-readable to us. */
function sanitiseMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => [key, String(value).slice(0, 500)]),
  );
}

/**
 * Stripe accepts a session lifetime between 30 minutes and 24 hours. An
 * operator's shorter hold is honoured on our side but cannot be pushed into
 * the session, so it is clamped here rather than making session creation fail.
 */
function clampSessionMinutes(minutes) {
  return Math.min(Math.max(Number(minutes) || CHECKOUT_HOLD.minutes, 30), 24 * 60);
}

function idOf(value) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

/**
 * Resolve the configured provider.
 *
 * Cached per resolved configuration rather than per provider name, so a
 * credential an administrator rotates from the admin panel is picked up on
 * the next call instead of being pinned by the first one.
 */
let cached = null;

/**
 * Build the adapter one resolved configuration describes.
 *
 * Exported so a connection test can construct a provider from a configuration
 * that has been saved but not yet switched on — which is the order an
 * operator actually does things in.
 */
export function buildPaymentProvider(resolved) {
  if (resolved.provider !== "stripe") return new MockPaymentProvider();

  return new StripePaymentProvider({
    secretKey: resolved.secrets.secretKey,
    webhookSecret: resolved.secrets.webhookSecret,
    // One endpoint by default; a separate Connect endpoint is opt-in.
    connectWebhookSecret: resolved.secrets.connectWebhookSecret || resolved.secrets.webhookSecret,
  });
}

export async function getPaymentProvider() {
  const resolved = await requireIntegrationConfig(INTEGRATION_MODULES.PAYMENT);

  const key = `${resolved.provider}:${resolved.source}:${resolved.updatedAt?.getTime?.() ?? 0}`;
  if (cached?.key === key) return cached.provider;

  const provider = buildPaymentProvider(resolved);
  cached = { key, provider };
  return provider;
}

/**
 * Drop the memoised provider.
 *
 * Used by the integration suite, which switches providers between sections to
 * exercise both adapters in one process, and by the settings service when an
 * administrator saves a new configuration.
 */
export function resetPaymentProvider() {
  cached = null;
}

/** Which mode payments are running in, for the UI and the admin health panel. */
export async function paymentProviderStatus() {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.PAYMENT);
  const live = resolved.enabled && resolved.configured && resolved.provider !== DEVELOPMENT;

  return {
    provider: resolved.provider,
    label: resolved.label,
    mode: resolved.provider === DEVELOPMENT ? "development" : "production",
    ok: resolved.enabled && resolved.configured,
    enabled: resolved.enabled,
    hostedCheckout: live,
    // The signing secret is what makes an incoming event trustworthy; whether
    // one is present is a configuration fact, and its value is never read here.
    webhooksConfigured: Boolean(resolved.secrets?.webhookSecret),
  };
}
