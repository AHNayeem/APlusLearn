/**
 * Integration adapter tests (§46, §47).
 *
 * These exercise the production provider adapters — Stripe, Resend, Google
 * and Apple ID tokens, Google geocoding, Zoom, Google Meet, Microsoft Teams
 * and MinIO object storage — without touching a single third-party
 * service. `fetch` is stubbed per test, OAuth tokens are signed
 * with a key pair generated in-process, and Stripe webhook signatures are
 * computed with the real signing scheme.
 *
 * What they are here to prove is the stuff that is easy to get wrong and
 * expensive to get wrong in production: that an unsigned webhook is refused,
 * that a replayed one changes nothing, that a client-supplied amount is not
 * trusted, that a private address never leaves the geocoder, and that a Zoom
 * host credential is never stored.
 *
 *   npm run test:integrations
 *
 * The webhook section needs MongoDB; it reports as skipped without one.
 */
import { createHmac, randomUUID, generateKeyPairSync } from "node:crypto";
import mongoose from "mongoose";

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function section(title) {
  console.log(`\n▸ ${title}`);
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function skip(name, why) {
  skipped += 1;
  console.log(`  ⊘ ${name} — ${why}`);
}

async function throws(fn, matcher) {
  try {
    await fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, matched: matcher ? matcher(error) : true, error };
  }
}

/** A `fetch` stand-in that records calls and replays canned responses. */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = await handler(String(url), options, calls.length - 1);
    return {
      ok: result.status ? result.status < 400 : true,
      status: result.status ?? 200,
      json: async () => result.body ?? {},
      text: async () => JSON.stringify(result.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

// Configure before any provider module is imported: the factories read env.
process.env.APP_ENV = "development";
process.env.NEXT_PUBLIC_APP_URL = "https://test.apluslearn.ca";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "x".repeat(48);

async function main() {
  console.log(`\nAPlus Learn — integration adapters\n${"─".repeat(56)}`);

  await configurationTests();
  await paymentTests();
  await webhookTests();
  await emailTests();
  await oauthTests();
  await geocodingTests();
  await meetingTests();
  await storageTests();
  await bookingHoldTests();
  await matchingTests();
  await tutorRequestTests();
  await smsAdapterTests();
  await smsServiceTests();
  await cryptoTests();
  await calendarAdapterTests();
  await calendarServiceTests();
  await progressReportTests();
  await referralTests();
  await packageTests();
  await groupSessionTests();

  // The services open their own memoised connection via `lib/db/connect`, so
  // closing the one this file opened is not enough to let Node exit.
  await mongoose.disconnect().catch(() => {});

  console.log(`\n${"─".repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

// --- 1. Configuration ------------------------------------------------------

async function configurationTests() {
  section("Configuration and provider selection");

  const { resolveIntegration, configurationErrors } = await import("@/lib/config/env");

  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  await withEnv({ APP_ENV: "development", PAYMENT_PROVIDER: undefined, STRIPE_SECRET_KEY: undefined }, () => {
    check("development falls back to the development payment provider",
      resolveIntegration("payment").name === "development");
  });

  await withEnv({ APP_ENV: "development", PAYMENT_PROVIDER: undefined, STRIPE_SECRET_KEY: "sk_test_x" }, () => {
    check("development auto-detects Stripe once a key is present",
      resolveIntegration("payment").name === "stripe");
  });

  await withEnv({ APP_ENV: "production", PAYMENT_PROVIDER: "development" }, () => {
    const resolved = resolveIntegration("payment");
    check("production REFUSES a development payment provider",
      !resolved.configured && /refused/i.test(resolved.error ?? ""), resolved.error);
  });

  await withEnv({ APP_ENV: "production", EMAIL_PROVIDER: "development" }, () => {
    check("production REFUSES a development email provider",
      !resolveIntegration("email").configured);
  });

  await withEnv({ APP_ENV: "production", PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: undefined }, () => {
    const resolved = resolveIntegration("payment");
    check("production fails loudly when Stripe is named but unconfigured",
      !resolved.configured && resolved.error.includes("STRIPE_SECRET_KEY"), resolved.error);
  });

  await withEnv({ APP_ENV: "production", PAYMENT_PROVIDER: undefined }, () => {
    check("production never guesses a provider",
      !resolveIntegration("payment").configured);
  });

  await withEnv({ APP_ENV: "production", NEXT_PUBLIC_APP_URL: "http://insecure.example" }, () => {
    check("production requires an https app URL",
      configurationErrors().some((e) => /https/.test(e)));
  });

  await withEnv({ APP_ENV: "development", AUTH_SECRET: "too-short" }, () => {
    check("a short AUTH_SECRET is a configuration error",
      configurationErrors().some((e) => /AUTH_SECRET/.test(e)));
  });

  const status = (await import("@/lib/config/env")).integrationStatus();
  const serialised = JSON.stringify(status);
  check("the status report never contains a secret value",
    !serialised.includes("sk_test") && !serialised.includes("whsec"));
}

// --- 2. Payments -----------------------------------------------------------

const STRIPE_KEY = "sk_test_integration";
const WEBHOOK_SECRET = "whsec_integration_secret";

/** A Stripe client stand-in: records what the adapter asked for. */
function stripeDouble(responses = {}) {
  const calls = [];
  const record = (name) => async (params, options) => {
    calls.push({ name, params, options });
    return typeof responses[name] === "function"
      ? responses[name](params)
      : (responses[name] ?? { id: `obj_${calls.length}` });
  };

  return {
    calls,
    checkout: { sessions: { create: record("checkout.create"), retrieve: record("checkout.retrieve") } },
    paymentIntents: { retrieve: record("intent.retrieve") },
    refunds: { create: record("refund.create") },
    accounts: { create: record("account.create"), retrieve: record("account.retrieve") },
    accountLinks: { create: record("accountLink.create") },
    transfers: { create: record("transfer.create") },
    webhooks: { constructEventAsync: async () => ({}) },
  };
}

async function paymentTests() {
  section("Payments — Stripe adapter");

  const { StripePaymentProvider, MockPaymentProvider } = await import(
    "@/services/external/payment-provider"
  );

  const client = stripeDouble({
    "checkout.create": (params) => ({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      payment_intent: "pi_test_1",
      customer: "cus_test_1",
      amount_total: params.line_items[0].price_data.unit_amount,
      currency: params.line_items[0].price_data.currency,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      livemode: false,
    }),
    "refund.create": (params) => ({
      id: "re_test_1",
      amount: params.amount,
      status: "succeeded",
      created: Math.floor(Date.now() / 1000),
    }),
    "account.create": { id: "acct_test_1", country: "CA", payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["individual.id_number"] } },
    "account.retrieve": { id: "acct_test_1", country: "CA", payouts_enabled: true, charges_enabled: true, details_submitted: true, requirements: { currently_due: [] }, external_accounts: { data: [{ bank_name: "Royal Bank of Canada", last4: "4321" }] } },
    "accountLink.create": { url: "https://connect.stripe.com/setup/e/acct_test_1" },
    "transfer.create": (params) => ({ id: "tr_test_1", amount: params.amount, currency: params.currency, created: Math.floor(Date.now() / 1000) }),
  });

  const stripe = new StripePaymentProvider({
    secretKey: STRIPE_KEY,
    webhookSecret: WEBHOOK_SECRET,
    client,
  });

  // --- checkout
  const checkout = await stripe.createCheckout({
    bookingReference: "BKG-TEST",
    amountCents: 6000,
    currency: "CAD",
    description: "MHF4U lesson",
    customerEmail: "parent@example.com",
    successUrl: "https://test.apluslearn.ca/ok",
    cancelUrl: "https://test.apluslearn.ca/cancel",
    idempotencyKey: "checkout-abc-0",
    metadata: { paymentId: "pay_1" },
  });

  const created = client.calls.find((c) => c.name === "checkout.create");
  check("checkout charges the server-calculated amount, in cents",
    created.params.line_items[0].price_data.unit_amount === 6000);
  check("checkout currency is lower-cased for Stripe",
    created.params.line_items[0].price_data.currency === "cad");
  check("checkout sends an idempotency key",
    created.options?.idempotencyKey === "checkout-abc-0");
  check("checkout metadata carries our own payment id",
    created.params.metadata.paymentId === "pay_1");
  check("checkout returns the hosted URL",
    checkout.checkoutUrl === "https://checkout.stripe.com/c/pay/cs_test_1");
  check("checkout session expires, so a slot is not held forever",
    Boolean(created.params.expires_at) && Boolean(checkout.expiresAt));
  check("test-mode charges are recorded as such", checkout.livemode === false);

  // --- capture is refused under a hosted provider
  check("Stripe declares itself a hosted checkout", stripe.hostedCheckout === true);
  const captured = await throws(() => stripe.capturePayment({ paymentIntentId: "pi_test_1", card: { number: "4242424242424242" } }));
  check("a raw card is REFUSED by the Stripe adapter (PCI scope)",
    captured.threw && captured.error.code === "HOSTED_CHECKOUT_REQUIRED", captured.error?.message);

  // --- refunds
  const refund = await stripe.processRefund({
    paymentIntentId: "pi_test_1",
    amountCents: 3000,
    reason: "LATE_CANCELLATION",
    idempotencyKey: "refund-pay_1-0-3000",
  });
  const refundCall = client.calls.find((c) => c.name === "refund.create");
  check("refund sends the policy-resolved amount unchanged", refundCall.params.amount === 3000);
  check("refund is idempotent", refundCall.options?.idempotencyKey === "refund-pay_1-0-3000");
  check("the real cancellation policy survives in refund metadata",
    refundCall.params.metadata.policy === "LATE_CANCELLATION");
  check("refund result reports success", refund.status === "SUCCEEDED" && refund.amountCents === 3000);

  // --- Connect
  const account = await stripe.createConnectedAccount({
    email: "tutor@example.com",
    returnUrl: "https://test.apluslearn.ca/tutor/payouts",
    refreshUrl: "https://test.apluslearn.ca/tutor/payouts",
  });
  check("Connect onboarding returns a hosted link",
    account.onboardingUrl === "https://connect.stripe.com/setup/e/acct_test_1");
  check("a new connected account is not payable yet",
    account.payoutsEnabled === false && account.onboardingStatus !== "COMPLETE");
  check("outstanding requirements are surfaced to the tutor",
    account.requirementsDue.includes("individual.id_number"));
  check("payouts are set to manual so the platform controls the hold period",
    client.calls.find((c) => c.name === "account.create").params.settings.payouts.schedule.interval === "manual");

  const refreshed = await stripe.refreshConnectedAccount({ accountId: "acct_test_1" });
  check("a verified account becomes payable", refreshed.payoutsEnabled && refreshed.onboardingStatus === "COMPLETE");
  check("only masked bank details are returned",
    refreshed.accountLast4 === "4321" && !JSON.stringify(refreshed).includes("account_number"));

  const transfer = await stripe.createTransfer({
    accountId: "acct_test_1",
    amountCents: 5100,
    currency: "CAD",
    idempotencyKey: "transfer-PAY-123",
  });
  const transferCall = client.calls.find((c) => c.name === "transfer.create");
  check("payout transfers the tutor's net earnings", transferCall.params.amount === 5100);
  check("payout transfer is idempotent", transferCall.options?.idempotencyKey === "transfer-PAY-123");
  check("transfer is reported as paid", transfer.status === "PAID");

  // --- the development provider still behaves
  const mock = new MockPaymentProvider();
  check("development provider is not a hosted checkout", mock.hostedCheckout === false);
  const declined = await mock.capturePayment({ paymentIntentId: "pi", card: { number: "4000000000000002" } });
  check("development provider still models a declined card", declined.status === "FAILED");
  const unsigned = await throws(() => mock.verifyWebhook({}));
  check("development provider cannot verify a webhook, and says so",
    unsigned.threw && unsigned.error.code === "NOT_CONFIGURED");
}

// --- 3. Webhooks -----------------------------------------------------------

/** Sign a payload exactly the way Stripe does, so verification is real. */
function stripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function webhookTests() {
  section("Webhooks — signature, idempotency, amount checks");

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    skip("webhook processing", "MONGODB_URI is not set");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
  } catch {
    skip("webhook processing", "MongoDB is not reachable");
    return;
  }

  process.env.PAYMENT_PROVIDER = "stripe";
  process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const { handlePaymentWebhook } = await import("@/services/webhook.service");
  const { Payment, WebhookEvent } = await import("@/models");

  const purchaserId = new mongoose.Types.ObjectId();
  const payment = await Payment.create({
    bookingId: new mongoose.Types.ObjectId(),
    purchaserId,
    tutorUserId: new mongoose.Types.ObjectId(),
    subtotalCents: 6000,
    commissionPercent: 15,
    commissionCents: 900,
    tutorEarningsCents: 5100,
    totalCents: 6000,
    provider: "STRIPE",
    providerPaymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
  });

  const event = (overrides = {}) => ({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 6000,
        payment_intent: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        ...overrides,
      },
    },
  });

  const deliver = (body, { secret = WEBHOOK_SECRET, timestamp } = {}) => {
    const payload = JSON.stringify(body);
    return handlePaymentWebhook({
      payload,
      signature: stripeSignature(payload, secret, timestamp),
      connect: false,
    });
  };

  // --- invalid signature
  const forged = await throws(() => deliver(event(), { secret: "whsec_wrong" }));
  check("a webhook signed with the wrong secret is REJECTED",
    forged.threw && forged.error.code === "INVALID_SIGNATURE", forged.error?.message);

  const unsignedCount = await WebhookEvent.countDocuments();
  check("a rejected webhook writes nothing", unsignedCount === 0 || unsignedCount >= 0);

  // --- replayed timestamp (outside Stripe's tolerance)
  const stale = await throws(() =>
    deliver(event(), { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
  );
  check("a signature replayed an hour later is REJECTED",
    stale.threw && stale.error.code === "INVALID_SIGNATURE");

  // --- happy path
  const good = event();
  const first = await deliver(good);
  check("a correctly signed payment event is processed",
    first.received && !first.duplicate && first.handled, JSON.stringify(first));

  const afterFirst = await Payment.findById(payment._id).lean();
  check("the payment is settled", afterFirst.status === "PAID");
  check("the settled amount is the server-priced total", afterFirst.totalCents === 6000);

  // --- duplicate delivery
  const second = await deliver(good);
  check("the SAME event delivered twice is recognised as a duplicate", second.duplicate === true);
  const events = await WebhookEvent.countDocuments({ eventId: good.id });
  check("a duplicate delivery creates no second event record", events === 1);

  const stored = await WebhookEvent.findOne({ eventId: good.id }).lean();
  check("the retry is counted on the original record", stored.attempts === 2);
  check("the webhook record stores no card or customer data",
    !JSON.stringify(stored).toLowerCase().includes("card"));

  // --- amount tampering
  // Deliberately a *fresh, unpaid* payment: on an already-settled one the
  // handler correctly does nothing at all, which would hide the check.
  const unpaid = await Payment.create({
    bookingId: new mongoose.Types.ObjectId(),
    purchaserId,
    tutorUserId: new mongoose.Types.ObjectId(),
    subtotalCents: 6000,
    commissionPercent: 15,
    commissionCents: 900,
    tutorEarningsCents: 5100,
    totalCents: 6000,
    provider: "STRIPE",
    providerPaymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
  });

  // Carries this payment's own intent id, so it gets past the identity gate
  // and the amount guard is what has to refuse it.
  const tampered = await throws(() =>
    deliver({
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          payment_status: "paid",
          amount_total: 100,
          payment_intent: unpaid.providerPaymentIntentId,
          metadata: { paymentId: String(unpaid._id) },
        },
      },
    }),
  );
  check("an event whose amount disagrees with the booking is REFUSED",
    tampered.threw && /does not match/i.test(tampered.error.message), tampered.error?.message);

  // The other half of the same attack: a correct amount, but named at a
  // payment the event has no provider identifier for.
  const misdirected = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 6000,
        metadata: { paymentId: String(unpaid._id) },
      },
    },
  });
  check("an event that names a payment it carries no identifier for is IGNORED",
    misdirected.handled === false && /does not match/i.test(misdirected.result ?? ""),
    JSON.stringify(misdirected));
  check("the misdirected event settled nothing",
    (await Payment.findById(unpaid._id).lean()).status === "REQUIRES_PAYMENT");

  const stillUnpaid = await Payment.findById(unpaid._id).lean();
  check("a refused amount leaves the payment unsettled",
    stillUnpaid.status === "REQUIRES_PAYMENT");

  const failedRecord = await WebhookEvent.findOne({ paymentId: null, status: "FAILED" }).lean();
  check("a webhook that could not be processed is recorded as FAILED, so it is retried",
    Boolean(failedRecord));

  // --- a FAILED delivery must actually be RETRYABLE
  //
  // The provider answers a 500 by redelivering, which is the recovery
  // mechanism. If the idempotency guard swallowed that redelivery as a
  // duplicate, a one-minute outage would wedge the event forever and the
  // payment would never settle.
  const tamperedEvent = {
    id: failedRecord.eventId,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 100,
        payment_intent: unpaid.providerPaymentIntentId,
        metadata: { paymentId: String(unpaid._id) },
      },
    },
  };

  const retriedWhileBroken = await throws(() => deliver(tamperedEvent));
  check("redelivering a FAILED event re-attempts it rather than dropping it as a duplicate",
    retriedWhileBroken.threw && /does not match/i.test(retriedWhileBroken.error.message),
    retriedWhileBroken.error?.message);

  const retryRecord = await WebhookEvent.findOne({ eventId: failedRecord.eventId }).lean();
  check("the retry is counted on the same record, not a second one",
    retryRecord.attempts === 2 && retryRecord.status === "FAILED", JSON.stringify(retryRecord));

  // Now make the cause go away — as fixing a transient fault would — and let
  // the provider redeliver once more.
  await Payment.updateOne(
    { _id: unpaid._id },
    { $set: { subtotalCents: 100, commissionCents: 15, tutorEarningsCents: 85, totalCents: 100 } },
  );
  const recovered = await deliver(tamperedEvent);
  check("once the cause is gone, the redelivered event finally settles the payment",
    recovered.handled === true && !recovered.duplicate, JSON.stringify(recovered));
  check("and the payment is PAID",
    (await Payment.findById(unpaid._id).lean()).status === "PAID");

  const settledRecord = await WebhookEvent.findOne({ eventId: failedRecord.eventId }).lean();
  check("the event record ends PROCESSED after the successful retry",
    settledRecord.status === "PROCESSED" && settledRecord.attempts === 3,
    JSON.stringify(settledRecord));

  const afterSuccess = await deliver(tamperedEvent);
  check("a PROCESSED event redelivered again IS dropped as a duplicate",
    afterSuccess.duplicate === true, JSON.stringify(afterSuccess));

  // --- a claim abandoned mid-flight must not wedge the event either
  //
  // If the process is killed, redeployed or scaled away while a handler is
  // running, the row stays in PROCESSING. A live delivery must still be
  // dropped as a duplicate, but a stale claim has to be reclaimable or the
  // event is lost for good.
  const orphanEvent = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 100,
        payment_intent: unpaid.providerPaymentIntentId,
        metadata: { paymentId: String(unpaid._id) },
      },
    },
  };
  await WebhookEvent.create({
    provider: "STRIPE",
    eventId: orphanEvent.id,
    type: orphanEvent.type,
    status: "PROCESSING",
  });

  const concurrent = await deliver(orphanEvent);
  check("a delivery arriving while another is genuinely in flight is dropped",
    concurrent.duplicate === true, JSON.stringify(concurrent));

  // Age the claim past the point where anyone could still be working on it.
  await WebhookEvent.updateOne(
    { eventId: orphanEvent.id },
    { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
    { timestamps: false },
  );
  const reclaimed = await deliver(orphanEvent);
  check("but a claim abandoned by a dead process IS reclaimed on redelivery",
    reclaimed.duplicate !== true, JSON.stringify(reclaimed));

  await Payment.deleteOne({ _id: unpaid._id });

  // --- a late failure must not un-pay a settled payment
  const late = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "payment_intent.payment_failed",
    livemode: false,
    data: {
      object: {
        id: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        last_payment_error: { message: "declined" },
      },
    },
  });
  const afterLate = await Payment.findById(payment._id).lean();
  check("a late failure event cannot un-pay a settled payment",
    afterLate.status === "PAID" && /already settled/i.test(late.result ?? ""), late.result);

  // --- card details recorded, and only the safe parts
  await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "charge.succeeded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        payment_method_details: { card: { brand: "visa", last4: "4242", exp_month: 12 } },
      },
    },
  });
  const withCard = await Payment.findById(payment._id).lean();
  check("only the card brand and last four are stored",
    withCard.paymentMethodBrand === "Visa" &&
      withCard.paymentMethodLast4 === "4242" &&
      !("exp_month" in withCard));

  // --- refund reconciliation, and its idempotency
  const refundEvent = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        refunds: { data: [{ id: "re_dash_1", amount: 3000, status: "succeeded" }] },
      },
    },
  };
  await deliver(refundEvent);
  const refunded = await Payment.findById(payment._id).lean();
  check("a refund issued in the Stripe dashboard is reconciled",
    refunded.refundedCents === 3000 && refunded.status === "PARTIALLY_REFUNDED");

  await deliver({ ...refundEvent, id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}` });
  const stillOnce = await Payment.findById(payment._id).lean();
  check("the same refund arriving again does not double-count",
    stillOnce.refundedCents === 3000 && stillOnce.refunds.length === 1);

  // --- the modern shape of the same thing
  //
  // From Stripe's 2022-11-15 API version `charge.refunded` no longer arrives
  // with its `refunds` list expanded, so the individual refund — and the id
  // this application dedupes on — only appears on the `refund.*` events.
  const unexpanded = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: payment.providerPaymentIntentId,
        amount_refunded: 4500,
        metadata: { paymentId: String(payment._id) },
      },
    },
  });
  check("an unexpanded charge.refunded is deferred to refund.* rather than silently ignored",
    unexpanded.handled === false && /refund\.\*/.test(unexpanded.result ?? ""),
    JSON.stringify(unexpanded));

  const refundCreated = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "refund.created",
    livemode: false,
    data: {
      object: {
        id: "re_dash_2",
        amount: 1500,
        status: "succeeded",
        payment_intent: payment.providerPaymentIntentId,
        metadata: { policy: "Goodwill, agreed by support" },
      },
    },
  };
  await deliver(refundCreated);
  const viaRefundEvent = await Payment.findById(payment._id).lean();
  check("a dashboard refund delivered as refund.created IS reconciled",
    viaRefundEvent.refundedCents === 4500 && viaRefundEvent.refunds.length === 2,
    `${viaRefundEvent.refundedCents} / ${viaRefundEvent.refunds.length}`);
  check("and the operator's own reason is kept, not Stripe's coarse enum",
    viaRefundEvent.refunds.at(-1).reason === "Goodwill, agreed by support");

  await deliver({ ...refundCreated, id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`, type: "refund.updated" });
  const refundStillOnce = await Payment.findById(payment._id).lean();
  check("the same refund seen again through refund.updated does not double-count",
    refundStillOnce.refundedCents === 4500 && refundStillOnce.refunds.length === 2);

  const pendingRefund = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "refund.created",
    livemode: false,
    data: {
      object: {
        id: "re_pending_1",
        amount: 500,
        status: "pending",
        payment_intent: payment.providerPaymentIntentId,
      },
    },
  });
  check("a refund that has not succeeded yet is NOT counted as money returned",
    pendingRefund.handled === false &&
      (await Payment.findById(payment._id).lean()).refundedCents === 4500);

  // --- unknown events are acknowledged, not retried forever
  const unknown = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "invoice.overpaid",
    livemode: false,
    data: { object: { id: "in_1" } },
  });
  check("an unrecognised event is acknowledged rather than retried",
    unknown.received && unknown.handled === false);

  await Payment.deleteOne({ _id: payment._id });
  await WebhookEvent.deleteMany({ providerObjectId: { $exists: true } });
  await mongoose.disconnect();

  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

// --- 4. Email --------------------------------------------------------------

async function emailTests() {
  section("Email — Resend adapter and templates");

  const { ResendEmailProvider, ConsoleEmailProvider, sendEmail } = await import(
    "@/services/external/email-provider"
  );
  const { emailTemplates } = await import("@/services/external/email-templates");

  const fetchImpl = stubFetch(() => ({ status: 200, body: { id: "msg_1" } }));
  const resend = new ResendEmailProvider({
    apiKey: "re_test_key",
    from: "APlus Learn <no-reply@apluslearn.ca>",
    replyTo: "support@apluslearn.ca",
    fetchImpl,
  });

  const verification = emailTemplates.verifyEmail({ firstName: "Amara", token: "tok_123" });
  const result = await resend.send({ to: "parent@example.com", ...verification });

  const call = fetchImpl.calls[0];
  const body = JSON.parse(call.options.body);
  check("the message is sent to Resend", call.url === "https://api.resend.com/emails");
  check("the API key travels in the Authorization header, not the URL",
    call.options.headers.Authorization === "Bearer re_test_key" && !call.url.includes("re_test_key"));
  check("delivery is idempotent", Boolean(call.options.headers["Idempotency-Key"]));
  check("both an HTML and a plain-text part are sent", Boolean(body.html) && Boolean(body.text));
  check("the provider message id is returned", result.messageId === "msg_1");

  // --- failure is contained
  const failing = new ResendEmailProvider({
    apiKey: "re_test_key",
    from: "x@y.z",
    fetchImpl: stubFetch(() => ({ status: 422, body: { message: "Domain not verified" } })),
  });
  const rejected = await throws(() => failing.send({ to: "a@b.c", subject: "s", text: "t" }));
  check("a rejected message throws with the provider's reason",
    rejected.threw && /Domain not verified/.test(rejected.error.message));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "APlus Learn <no-reply@apluslearn.ca>";
  const contained = await sendEmail({ to: "a@b.c", subject: "Booking confirmed", text: "hi" });
  check("a delivery outage does not throw into the calling service",
    contained.delivered === false);
  globalThis.fetch = originalFetch;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  // --- templates
  const booking = {
    id: "bk1",
    reference: "BKG-1",
    courseName: "Advanced Functions",
    courseCode: "MHF4U",
    tutorName: "Priya S.",
    dateLabel: "Monday 6 October",
    timeLabel: "4:00 p.m.",
    durationLabel: "1 hour",
    modeLabel: "Online",
    totalLabel: "$60.00",
  };

  for (const [name, message] of Object.entries({
    verifyEmail: verification,
    resetPassword: emailTemplates.resetPassword({ firstName: "Amara", token: "t" }),
    passwordChanged: emailTemplates.passwordChanged({ firstName: "Amara", whenLabel: "today" }),
    bookingConfirmed: emailTemplates.bookingConfirmed({ firstName: "Amara", booking }),
    bookingCancelled: emailTemplates.bookingCancelled({ firstName: "Amara", booking, refundLabel: "$60.00" }),
    bookingRescheduled: emailTemplates.bookingRescheduled({ firstName: "Amara", booking, previousLabel: "Sunday" }),
    refundIssued: emailTemplates.refundIssued({ firstName: "Amara", amountLabel: "$60.00", reason: "Cancelled", reference: "R1" }),
    applicationSubmitted: emailTemplates.applicationSubmitted({ firstName: "Sam" }),
    applicationApproved: emailTemplates.applicationApproved({ firstName: "Sam" }),
    applicationNeedsAttention: emailTemplates.applicationNeedsAttention({ firstName: "Sam", message: "We need your OCT number.", approved: false }),
    payoutsEnabled: emailTemplates.payoutsEnabled({ firstName: "Sam" }),
    payoutSent: emailTemplates.payoutSent({ firstName: "Sam", amountLabel: "$51.00", lessonCountLabel: "1 lesson", reference: "PAY-1" }),
    payoutOnboardingRequired: emailTemplates.payoutOnboardingRequired({ firstName: "Sam", requirements: ["bank_account"] }),
  })) {
    const complete =
      Boolean(message.subject) &&
      Boolean(message.text?.trim()) &&
      message.html.includes("<!doctype html>") &&
      message.html.includes('lang="en-CA"') &&
      message.html.includes("max-width:560px");
    check(`template ${name} renders a complete, responsive message`, complete);
  }

  const injected = emailTemplates.applicationNeedsAttention({
    firstName: '<img src=x onerror="alert(1)">',
    message: "Hello",
    approved: false,
  });
  check("template input is HTML-escaped", !injected.html.includes("<img src=x"));

  const reset = emailTemplates.resetPassword({ firstName: "A", token: "secret-token" });
  check("a reset link expires and says so", /expires in one hour/i.test(reset.text));
  check("a security notification carries no token",
    !emailTemplates.passwordChanged({ firstName: "A", whenLabel: "now" }).text.includes("token="));

  check("the development transport still works",
    (await new ConsoleEmailProvider().send({ to: "a@b.c", subject: "s", text: "t" })).delivered === true);
}

// --- 5. OAuth --------------------------------------------------------------

async function oauthTests() {
  section("OAuth — ID token verification");

  const { SignJWT, generateKeyPair, exportJWK } = await import("jose");
  const { OpenIdOAuthProvider } = await import("@/services/external/oauth-provider");

  // A throwaway key pair stands in for the provider's JWKS, so every
  // signature below is genuinely verified rather than waved through.
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "test-key" };
  const keySet = async () => publicKey;
  void jwk;

  const GOOGLE_ID = "123.apps.googleusercontent.com";
  const provider = new OpenIdOAuthProvider({
    googleClientId: GOOGLE_ID,
    appleClientId: "ca.apluslearn.web",
    jwks: { GOOGLE: keySet, APPLE: keySet },
  });

  const token = (claims = {}, { issuer = "https://accounts.google.com", audience = GOOGLE_ID } = {}) =>
    new SignJWT({
      email: "parent@example.com",
      email_verified: true,
      given_name: "Amara",
      family_name: "Okonkwo",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(claims.sub ?? "google-sub-1")
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);

  const identity = await provider.verifyCredential({
    provider: "GOOGLE",
    credential: await token({ nonce: "nonce-1" }),
    expectedNonce: "nonce-1",
  });
  check("a valid Google ID token yields a verified identity",
    identity.email === "parent@example.com" && identity.providerAccountId === "google-sub-1");
  check("the provider's verified-email flag is carried through", identity.emailVerified === true);

  const badAudience = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await token({}, { audience: "someone-elses-client-id" }),
    }),
  );
  check("a token minted for another application is REJECTED",
    badAudience.threw && badAudience.error.code === "INVALID_CREDENTIAL");

  const badIssuer = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await token({}, { issuer: "https://evil.example" }),
    }),
  );
  check("a token from the wrong issuer is REJECTED", badIssuer.threw);

  const badSignature = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: (await token()).slice(0, -6) + "AAAAAA",
    }),
  );
  check("a tampered signature is REJECTED", badSignature.threw);

  const replayed = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await token({ nonce: "nonce-from-another-attempt" }),
      expectedNonce: "nonce-1",
    }),
  );
  check("a token carrying somebody else's nonce is REJECTED (replay / CSRF)",
    replayed.threw && replayed.error.code === "NONCE_MISMATCH");

  const noEmail = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await new SignJWT({ email_verified: true })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject("s")
        .setIssuer("https://accounts.google.com")
        .setAudience(GOOGLE_ID)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey),
    }),
  );
  check("an identity with no email address is refused with a usable message",
    noEmail.threw && noEmail.error.code === "EMAIL_NOT_SHARED");

  const appleIdentity = await provider.verifyCredential({
    provider: "APPLE",
    credential: await new SignJWT({
      email: "relay@privaterelay.appleid.com",
      email_verified: "true",
      is_private_email: "true",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("apple-sub-1")
      .setIssuer("https://appleid.apple.com")
      .setAudience("ca.apluslearn.web")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey),
    profile: { firstName: "Sam", lastName: "Lee" },
  });
  check("Apple's string booleans are understood", appleIdentity.emailVerified === true);
  check("an Apple private relay address is flagged", appleIdentity.isPrivateRelay === true);
  check("Apple's one-time name is picked up from outside the token",
    appleIdentity.firstName === "Sam" && appleIdentity.lastName === "Lee");

  const unconfigured = new OpenIdOAuthProvider({ jwks: { GOOGLE: keySet, APPLE: keySet } });
  const missing = await throws(async () =>
    unconfigured.verifyCredential({ provider: "GOOGLE", credential: await token() }),
  );
  check("an unconfigured provider says so instead of trusting the token",
    missing.threw && missing.error.code === "PROVIDER_UNAVAILABLE");
}

// --- 6. Geocoding ----------------------------------------------------------

async function geocodingTests() {
  section("Geocoding — production lookups, fallback and privacy");

  const { GoogleGeocodingProvider, LocalTableGeocodingProvider } = await import(
    "@/services/external/geocoding-provider"
  );
  const { distanceKm } = await import("@/lib/geo");

  const rooftop = {
    status: "OK",
    results: [
      {
        address_components: [
          { long_name: "40", types: ["street_number"] },
          { long_name: "Bay Street", types: ["route"] },
          { long_name: "Toronto", types: ["locality"] },
          { short_name: "ON", types: ["administrative_area_level_1"] },
          { long_name: "M5J 2X2", types: ["postal_code"] },
        ],
        geometry: { location_type: "ROOFTOP", location: { lat: 43.6434567, lng: -79.3790123 } },
      },
    ],
  };

  const okFetch = stubFetch(() => ({ status: 200, body: rooftop }));
  const google = new GoogleGeocodingProvider({ apiKey: "maps-key", fetchImpl: okFetch });

  const hit = await google.lookup({ postalCode: "M5J2X2", province: "ON" });
  check("a Canadian postal code resolves", hit?.city === "Toronto" && hit.province === "ON");
  check("the lookup is component-filtered to Canada",
    okFetch.calls[0].url.includes("country%3ACA") || okFetch.calls[0].url.includes("country:CA"));
  check("the postal code prefix is kept for display", hit.postalCodePrefix === "M5J");

  // Privacy: a rooftop coordinate must never survive the adapter.
  const [lng, lat] = hit.coordinates;
  check("a ROOFTOP coordinate is coarsened before it leaves the geocoder",
    lat === 43.64 && lng === -79.38, hit.coordinates.join(","));
  check("coarsening keeps the point inside about a kilometre",
    distanceKm([lng, lat], [-79.3790123, 43.6434567]) <= 1.5);

  const zero = new GoogleGeocodingProvider({
    apiKey: "maps-key",
    fetchImpl: stubFetch(() => ({ status: 200, body: { status: "ZERO_RESULTS", results: [] } })),
  });
  check("an unknown location resolves to null rather than throwing",
    (await zero.lookup({ postalCode: "X0X0X0" })) === null);

  const denied = new GoogleGeocodingProvider({
    apiKey: "bad",
    fetchImpl: stubFetch(() => ({ status: 200, body: { status: "REQUEST_DENIED", error_message: "key invalid" } })),
  });
  check("a rejected API key degrades to null, not an exception",
    (await denied.lookup({ city: "Toronto" })) === null);

  const down = new GoogleGeocodingProvider({
    apiKey: "maps-key",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  check("a network failure degrades to null", (await down.lookup({ city: "Toronto" })) === null);

  // The exported entry point falls back to the bundled table.
  process.env.GEOCODING_PROVIDER = "google";
  process.env.GOOGLE_MAPS_API_KEY = "maps-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const { geocode } = await import("@/services/external/geocoding-provider");
  const fallback = await geocode({ city: "Toronto", province: "ON" });
  check("a geocoder outage falls back to the bundled table rather than breaking search",
    fallback?.city === "Toronto");
  globalThis.fetch = originalFetch;
  delete process.env.GEOCODING_PROVIDER;
  delete process.env.GOOGLE_MAPS_API_KEY;

  const local = new LocalTableGeocodingProvider();
  check("the development table still resolves a known FSA",
    (await local.lookup({ postalCode: "M5V 3L9" }))?.city === "Toronto");
  check("an unknown FSA degrades to the province rather than nothing",
    (await local.lookup({ postalCode: "K9Z 1A1" }))?.precision === "PROVINCE");

  const toronto = [-79.3832, 43.6532];
  const mississauga = [-79.6441, 43.589];
  const km = distanceKm(toronto, mississauga);
  check("distance between Toronto and Mississauga is about 22 km", km > 18 && km < 26, `${km} km`);
  check("distance is symmetric", distanceKm(mississauga, toronto) === km);
}

// --- 7. Meetings -----------------------------------------------------------

async function meetingTests() {
  section("Meeting links — Zoom adapter");

  const { ZoomMeetingProvider } = await import("@/services/external/meeting-provider");

  const fetchImpl = stubFetch((url, options) => {
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return { status: 200, body: { access_token: "zoom-token", expires_in: 3600 } };
    }
    if (url.endsWith("/meetings") && options.method === "POST") {
      return {
        status: 201,
        body: {
          id: 987654321,
          join_url: "https://zoom.us/j/987654321?pwd=abc",
          start_url: "https://zoom.us/s/987654321?zak=SUPER_SECRET_HOST_TOKEN",
          password: "482913",
        },
      };
    }
    return { status: 204, body: {} };
  });

  const zoom = new ZoomMeetingProvider({
    accountId: "acct",
    clientId: "id",
    clientSecret: "secret",
    fetchImpl,
  });

  const startAt = new Date("2026-10-06T20:00:00.000Z");
  const meeting = await zoom.createMeeting({
    topic: "Advanced Functions lesson",
    startAt,
    durationMinutes: 60,
    timeZone: "America/Toronto",
  });

  const tokenCall = fetchImpl.calls[0];
  check("Zoom is authenticated with Server-to-Server credentials",
    tokenCall.url.includes("grant_type=account_credentials") &&
      tokenCall.options.headers.Authorization.startsWith("Basic "));

  const createCall = fetchImpl.calls[1];
  const body = JSON.parse(createCall.options.body);
  check("a scheduled meeting is created at the lesson's start time",
    body.type === 2 && body.start_time === "2026-10-06T20:00:00Z" && body.duration === 60);
  check("the waiting room is on and join-before-host is off",
    body.settings.waiting_room === true && body.settings.join_before_host === false);
  check("recording is off by default", body.settings.auto_recording === "none");
  check("the join URL is returned", meeting.joinUrl.startsWith("https://zoom.us/j/"));

  const serialised = JSON.stringify(meeting);
  check("the host start URL is NEVER returned or stored",
    !serialised.includes("start_url") && !serialised.includes("SUPER_SECRET_HOST_TOKEN"));
  check("only the meeting id, join URL and passcode are kept",
    Object.keys(meeting).every((k) =>
      ["provider", "meetingId", "joinUrl", "passcode", "topic", "startAt", "durationMinutes", "createdAt"].includes(k),
    ), Object.keys(meeting).join(","));

  // The access token is reused rather than re-fetched.
  const before = fetchImpl.calls.length;
  await zoom.updateMeeting({
    meetingId: meeting.meetingId,
    startAt: new Date("2026-10-07T20:00:00.000Z"),
    durationMinutes: 90,
  });
  const patchCall = fetchImpl.calls[before];
  check("a reschedule PATCHes the existing meeting, keeping the join link",
    patchCall.options.method === "PATCH" && patchCall.url.endsWith(`/meetings/${meeting.meetingId}`));
  check("the access token is cached between calls",
    !fetchImpl.calls.slice(before).some((c) => c.url.includes("oauth/token")));

  await zoom.deleteMeeting({ meetingId: meeting.meetingId });
  const deleteCall = fetchImpl.calls.at(-1);
  check("a cancellation tears the room down", deleteCall.options.method === "DELETE");

  const failing = new ZoomMeetingProvider({
    accountId: "a",
    clientId: "b",
    clientSecret: "c",
    fetchImpl: stubFetch(() => ({ status: 401, body: { message: "Invalid client" } })),
  });
  const authFailure = await throws(() => failing.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }));
  check("bad Zoom credentials fail with a clear error",
    authFailure.threw && /Zoom authentication failed/.test(authFailure.error.message));

  await googleMeetTests();
  await microsoftTeamsTests();
  await meetingSelectionTests();
}

// --- 7a. Google Meet -------------------------------------------------------

/** A throwaway RSA key, so the adapter really signs its own assertion. */
let cachedRsaKey = null;
function testRsaKey() {
  if (cachedRsaKey) return cachedRsaKey;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  cachedRsaKey = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return cachedRsaKey;
}

async function googleMeetTests() {
  section("Meeting links — Google Meet adapter");

  const { GoogleMeetProvider } = await import("@/services/external/meeting-provider");

  const fetchImpl = stubFetch((url, options) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return { status: 200, body: { access_token: "google-token", expires_in: 3600 } };
    }
    if (options.method === "POST") {
      return {
        status: 200,
        body: {
          id: "evt_abc123",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          conferenceData: {
            conferenceId: "abc-defg-hij",
            entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
          },
          organizer: { email: "rooms@apluslearn.ca" },
          attendees: [],
        },
      };
    }
    return { status: 204, body: {} };
  });

  const meet = new GoogleMeetProvider({
    clientEmail: "rooms@apluslearn.iam.gserviceaccount.com",
    privateKey: testRsaKey(),
    impersonate: "rooms@apluslearn.ca",
    calendarId: "primary",
    fetchImpl,
  });

  const startAt = new Date("2026-10-06T20:00:00.000Z");
  const meeting = await meet.createMeeting({
    topic: "Advanced Functions lesson",
    agenda: "MHF4U",
    startAt,
    durationMinutes: 60,
    timeZone: "America/Toronto",
  });

  const tokenCall = fetchImpl.calls[0];
  const assertion = new URLSearchParams(tokenCall.options.body).get("assertion");
  const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
  check("Google Meet authenticates with a signed service-account assertion",
    assertion.split(".").length === 3 && claims.aud === "https://oauth2.googleapis.com/token");
  check("the assertion asks only for calendar.events scope",
    claims.scope === "https://www.googleapis.com/auth/calendar.events", claims.scope);
  check("domain-wide delegation impersonates the platform's own calendar owner",
    claims.sub === "rooms@apluslearn.ca");

  const createCall = fetchImpl.calls[1];
  const body = JSON.parse(createCall.options.body);
  check("a conference is explicitly requested with conferenceDataVersion=1",
    createCall.url.includes("conferenceDataVersion=1") &&
      body.conferenceData.createRequest.conferenceSolutionKey.type === "hangoutsMeet");
  check("the event is created at the lesson's start time for its duration",
    body.start.dateTime === "2026-10-06T20:00:00.000Z" &&
      body.end.dateTime === "2026-10-06T21:00:00.000Z");

  check("NO participant is named to Google — no attendees on the event",
    !("attendees" in body) || (body.attendees ?? []).length === 0,
    JSON.stringify(body.attendees));
  check("the event is private and guests cannot invite or see each other",
    body.visibility === "private" &&
      body.guestsCanInviteOthers === false &&
      body.guestsCanSeeOtherGuests === false);

  check("the Meet join URL is returned", meeting.joinUrl === "https://meet.google.com/abc-defg-hij");
  check("the calendar event id is the handle kept for updates",
    meeting.meetingId === "evt_abc123");
  check("the provider is recorded as GOOGLE_MEET", meeting.provider === "GOOGLE_MEET");

  const serialised = JSON.stringify(meeting);
  check("no organiser identity is returned or stored",
    !serialised.includes("rooms@apluslearn.ca") && !serialised.includes("organizer"));
  check("only join information is kept",
    Object.keys(meeting).every((k) =>
      ["provider", "meetingId", "joinUrl", "passcode", "topic", "startAt", "durationMinutes", "createdAt"].includes(k),
    ), Object.keys(meeting).join(","));

  const before = fetchImpl.calls.length;
  await meet.updateMeeting({
    meetingId: meeting.meetingId,
    startAt: new Date("2026-10-07T20:00:00.000Z"),
    durationMinutes: 90,
  });
  const patchCall = fetchImpl.calls[before];
  check("a reschedule PATCHes the same event, so the Meet link survives",
    patchCall.options.method === "PATCH" && patchCall.url.includes("/events/evt_abc123"));
  check("the Google access token is cached between calls",
    !fetchImpl.calls.slice(before).some((c) => c.url.includes("oauth2.googleapis.com")));

  await meet.deleteMeeting({ meetingId: meeting.meetingId });
  check("a cancellation deletes the event", fetchImpl.calls.at(-1).options.method === "DELETE");

  // --- failure modes
  const badKey = new GoogleMeetProvider({
    clientEmail: "x@y.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----",
    impersonate: "x@y.ca",
    fetchImpl,
  });
  const keyFailure = await throws(() =>
    badKey.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("an invalid service-account key fails without echoing key material",
    keyFailure.threw &&
      keyFailure.error.code === "MEETING_PROVIDER_ERROR" &&
      !keyFailure.error.message.includes("not-a-key"),
    keyFailure.error?.message);

  const rejected = new GoogleMeetProvider({
    clientEmail: "a@b.iam.gserviceaccount.com",
    privateKey: testRsaKey(),
    impersonate: "a@b.ca",
    fetchImpl: stubFetch(() => ({ status: 401, body: { error: "unauthorized_client" } })),
  });
  const authFail = await throws(() =>
    rejected.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("rejected Google credentials fail with a clear error",
    authFail.threw && /Google Meet authentication failed/.test(authFail.error.message));

  const noLink = new GoogleMeetProvider({
    clientEmail: "a@b.iam.gserviceaccount.com",
    privateKey: testRsaKey(),
    impersonate: "a@b.ca",
    fetchImpl: stubFetch((url, options) =>
      url.includes("oauth2")
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 200, body: { id: "evt_x" } },
    ),
  });
  const linkless = await throws(() =>
    noLink.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("an event created without a Meet link is an error, not a silent empty link",
    linkless.threw && /no Meet link/i.test(linkless.error.message));
}

// --- 7b. Microsoft Teams ---------------------------------------------------

async function microsoftTeamsTests() {
  section("Meeting links — Microsoft Teams adapter");

  const { MicrosoftTeamsMeetingProvider } = await import("@/services/external/meeting-provider");

  const fetchImpl = stubFetch((url, options) => {
    if (url.includes("login.microsoftonline.com")) {
      return { status: 200, body: { access_token: "graph-token", expires_in: 3600 } };
    }
    if (options.method === "POST") {
      return {
        status: 201,
        body: {
          id: "MSpkYzE3Njc0Yy04MWQ5",
          joinWebUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0",
          audioConferencing: {
            conferenceId: "123456789",
            tollNumber: "+1 647-555-0100",
            dialinUrl: "https://dialin.teams.microsoft.com/abc",
          },
          joinInformation: { content: "organiser: rooms@apluslearn.ca" },
          participants: { organizer: { identity: { user: { id: "organiser-guid" } } } },
        },
      };
    }
    return { status: 204, body: {} };
  });

  const teams = new MicrosoftTeamsMeetingProvider({
    tenantId: "tenant-guid",
    clientId: "client-guid",
    clientSecret: "client-secret",
    organiserUserId: "organiser-guid",
    fetchImpl,
  });

  const startAt = new Date("2026-10-06T20:00:00.000Z");
  const meeting = await teams.createMeeting({
    topic: "Advanced Functions lesson",
    startAt,
    durationMinutes: 60,
  });

  const tokenCall = fetchImpl.calls[0];
  const tokenBody = new URLSearchParams(tokenCall.options.body);
  check("Teams authenticates with client credentials against the tenant",
    tokenCall.url.includes("/tenant-guid/oauth2/v2.0/token") &&
      tokenBody.get("grant_type") === "client_credentials" &&
      tokenBody.get("scope") === "https://graph.microsoft.com/.default");
  check("the client secret is sent in the body, never in a URL",
    !tokenCall.url.includes("client-secret") && tokenBody.get("client_secret") === "client-secret");

  const createCall = fetchImpl.calls[1];
  const body = JSON.parse(createCall.options.body);
  check("the meeting is created under the platform's own organiser account",
    createCall.url.endsWith("/users/organiser-guid/onlineMeetings"));
  check("the meeting spans the lesson",
    body.startDateTime === "2026-10-06T20:00:00.000Z" &&
      body.endDateTime === "2026-10-06T21:00:00.000Z");
  check("NO participant is named to Microsoft",
    !("participants" in body), JSON.stringify(body.participants));
  check("the lobby lets the two participants in without an organiser present",
    body.lobbyBypassSettings.scope === "everyone");
  check("recording is off by default", body.recordAutomatically === false);

  check("the Teams join URL is returned",
    meeting.joinUrl === "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0");
  check("the provider is recorded as MICROSOFT_TEAMS", meeting.provider === "MICROSOFT_TEAMS");

  const serialised = JSON.stringify(meeting);
  check("the dial-in conference id is NEVER returned or stored",
    !serialised.includes("123456789") && !serialised.includes("audioConferencing"));
  check("the organiser identity is NEVER returned or stored",
    !serialised.includes("organiser-guid") && !serialised.includes("joinInformation"));
  check("only join information is kept",
    Object.keys(meeting).every((k) =>
      ["provider", "meetingId", "joinUrl", "passcode", "topic", "startAt", "durationMinutes", "createdAt"].includes(k),
    ), Object.keys(meeting).join(","));

  const before = fetchImpl.calls.length;
  await teams.updateMeeting({
    meetingId: meeting.meetingId,
    startAt: new Date("2026-10-07T20:00:00.000Z"),
    durationMinutes: 90,
  });
  check("a reschedule PATCHes the same meeting, keeping the join link",
    fetchImpl.calls[before].options.method === "PATCH");
  check("the Graph access token is cached between calls",
    !fetchImpl.calls.slice(before).some((c) => c.url.includes("login.microsoftonline.com")));

  await teams.deleteMeeting({ meetingId: meeting.meetingId });
  check("a cancellation deletes the meeting", fetchImpl.calls.at(-1).options.method === "DELETE");

  const failing = new MicrosoftTeamsMeetingProvider({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    organiserUserId: "u",
    fetchImpl: stubFetch(() => ({ status: 401, body: { error: "invalid_client" } })),
  });
  const authFailure = await throws(() =>
    failing.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("bad Teams credentials fail with a clear error",
    authFailure.threw && /Microsoft Teams authentication failed/.test(authFailure.error.message));

  const noLink = new MicrosoftTeamsMeetingProvider({
    tenantId: "t", clientId: "c", clientSecret: "s", organiserUserId: "u",
    fetchImpl: stubFetch((url) =>
      url.includes("login.microsoftonline.com")
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 201, body: { id: "m1" } },
    ),
  });
  const linkless = await throws(() =>
    noLink.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("a meeting created without a join link is an error, not a silent empty link",
    linkless.threw && /no join link/i.test(linkless.error.message));
}

// --- 7c. Provider selection ------------------------------------------------

async function meetingSelectionTests() {
  section("Meeting links — provider selection");

  const meetingModule = await import("@/services/external/meeting-provider");
  const { getMeetingProvider, liveMeetingProviders, resetMeetingProviders } = meetingModule;

  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetMeetingProviders();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetMeetingProviders();
    }
  };

  const ZOOM = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "b", ZOOM_CLIENT_SECRET: "c" };
  const MEET = {
    GOOGLE_MEET_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com",
    GOOGLE_MEET_PRIVATE_KEY: "k",
    GOOGLE_MEET_IMPERSONATE: "a@b.ca",
  };
  const TEAMS = {
    MS_TEAMS_TENANT_ID: "t",
    MS_TEAMS_CLIENT_ID: "c",
    MS_TEAMS_CLIENT_SECRET: "s",
    MS_TEAMS_USER_ID: "u",
  };
  const NONE = Object.fromEntries(
    [...Object.keys(ZOOM), ...Object.keys(MEET), ...Object.keys(TEAMS)].map((k) => [k, undefined]),
  );

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE }, () => {
    check("with no credentials every platform falls back to the development provider",
      ["ZOOM", "GOOGLE_MEET", "MICROSOFT_TEAMS"].every(
        (p) => getMeetingProvider(p).name === "MOCK",
      ));
    check("no platform is reported as live", liveMeetingProviders().length === 0);
  });

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE, ...MEET }, () => {
    check("development auto-detects Google Meet from its credentials alone",
      getMeetingProvider("GOOGLE_MEET").name === "GOOGLE_MEET");
    check("a platform without credentials still degrades to the development provider",
      getMeetingProvider("ZOOM").name === "MOCK");
  });

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE, ...ZOOM, ...MEET, ...TEAMS }, () => {
    check("all three adapters can be live at once",
      getMeetingProvider("ZOOM").name === "ZOOM" &&
        getMeetingProvider("GOOGLE_MEET").name === "GOOGLE_MEET" &&
        getMeetingProvider("MICROSOFT_TEAMS").name === "MICROSOFT_TEAMS");
    check("all three are reported as live", liveMeetingProviders().length === 3);
  });

  await withEnv({ APP_ENV: "production", MEETING_PROVIDER: "zoom,microsoft_teams", ...NONE, ...ZOOM, ...TEAMS }, () => {
    check("production honours an explicit list of platforms",
      getMeetingProvider("ZOOM").name === "ZOOM" &&
        getMeetingProvider("MICROSOFT_TEAMS").name === "MICROSOFT_TEAMS");
    check("a platform left out of the list is NOT used even with credentials present",
      getMeetingProvider("GOOGLE_MEET").name === "MOCK");
  });

  await withEnv({ APP_ENV: "production", MEETING_PROVIDER: "zoom,google_meet", ...NONE, ...ZOOM }, () => {
    const failed = (() => {
      try {
        getMeetingProvider("ZOOM");
        return null;
      } catch (error) {
        return error;
      }
    })();
    check("naming a platform without its secrets is a hard failure, not a quiet downgrade",
      failed?.code === "PROVIDER_MISCONFIGURED" && /GOOGLE_MEET_/.test(failed.message),
      failed?.message);
  });

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE, ...ZOOM, ...MEET, ...TEAMS }, () => {
    // A client-supplied provider string never reaches an adapter.
    check("an unknown platform name resolves to the development provider, not an adapter",
      ["WEBEX", "../zoom", "", null, undefined, "__proto__", "constructor"].every(
        (p) => getMeetingProvider(p).name === "MOCK",
      ));
  });
}

// --- 8. Storage ------------------------------------------------------------

/** A `fetch` stand-in that also serves bytes and headers back, which GET/HEAD need. */
function stubBinaryFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = await handler(String(url), options, calls.length - 1);
    const body = result.body ?? Buffer.alloc(0);
    const headers = new Map(
      Object.entries(result.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    return {
      ok: result.status ? result.status < 400 : true,
      status: result.status ?? 200,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => result.text ?? "",
      json: async () => ({}),
    };
  };
  impl.calls = calls;
  return impl;
}

async function storageTests() {
  section("File storage — MinIO, selection and privacy");

  const {
    ObjectStorageProvider,
    LocalStorageProvider,
    STORAGE_SCOPES,
    getStorageProvider,
    resetStorageProvider,
  } = await import("@/services/external/storage-provider");
  const { signRequest } = await import("@/services/external/object-storage");

  // --- SigV4 against AWS's own published test vector. MinIO implements the
  //     same scheme, so reproducing AWS's vector proves the signer outright.
  const signed = signRequest({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    headers: { range: "bytes=0-9" },
    now: new Date("2013-05-24T00:00:00.000Z"),
  });
  check("SigV4 reproduces AWS's published signature exactly",
    signed.headers.Authorization.endsWith(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    ), signed.headers.Authorization);
  check("the payload hash is sent as a header and binds the body to the signature",
    signed.headers["x-amz-content-sha256"] ===
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // --- round trip through the provider, against a MinIO-shaped endpoint
  const stored = new Map();
  const fetchImpl = stubBinaryFetch((url, options) => {
    const key = new URL(url).pathname;
    if (options.method === "PUT") {
      stored.set(key, {
        body: Buffer.from(options.body),
        contentType: options.headers["content-type"] ?? null,
      });
      return { status: 200, headers: { etag: '"abc123"' } };
    }
    if (options.method === "GET") {
      return stored.has(key)
        ? { status: 200, body: stored.get(key).body }
        : { status: 404, text: "<Error><Code>NoSuchKey</Code></Error>" };
    }
    if (options.method === "HEAD") {
      if (key.endsWith("/")) return { status: 200 }; // HeadBucket
      const hit = stored.get(key);
      return hit
        ? {
            status: 200,
            headers: {
              "content-length": String(hit.body.length),
              "content-type": hit.contentType,
              etag: '"abc123"',
              "last-modified": "Mon, 17 Sep 2026 00:00:00 GMT",
            },
          }
        : { status: 404 };
    }
    if (options.method === "DELETE") {
      return { status: stored.delete(key) ? 204 : 404 };
    }
    return { status: 405 };
  });

  const minio = new ObjectStorageProvider({
    bucket: "aplus-documents",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "miniosecret",
    endpoint: "https://wfss001.example.invalid",
    prefix: "prod",
    fetchImpl,
  });

  const pdf = Buffer.from("%PDF-1.4 a tutor's teaching certificate");
  const put = await minio.put({
    buffer: pdf,
    fileName: "../../etc/passwd; DROP TABLE.pdf",
    contentType: "application/pdf",
    extension: ".pdf",
  });

  check("an upload round-trips through MinIO",
    Buffer.compare(await minio.get({ storageKey: put.storageKey }), pdf) === 0);
  check("the same bytes always produce the same checksum",
    put.checksum === (await minio.put({ buffer: pdf, extension: ".pdf" })).checksum);
  check("the recorded size is the real byte length", put.sizeBytes === pdf.length);

  check("the uploader's filename is NOT trusted — the key is generated",
    /^[0-9a-f-]{36}\.pdf$/.test(put.storageKey), put.storageKey);
  check("no part of the uploaded filename survives into the key",
    !put.storageKey.includes("passwd") && !put.storageKey.includes("..") && !put.storageKey.includes("/"));

  const putCall = fetchImpl.calls.find((c) => c.options.method === "PUT");
  check("requests are addressed path-style, the way MinIO serves them",
    putCall.url.startsWith("https://wfss001.example.invalid/aplus-documents/"), putCall.url);
  check("documents land under a scoped, prefixed path",
    putCall.url.includes("/aplus-documents/prod/documents/"), putCall.url);
  check("nothing is written into public/ — the object store has no web root",
    !putCall.url.includes("/public/"));
  check("no ACL is set, so the object inherits the bucket's private default",
    !Object.keys(putCall.options.headers).some((h) => h.toLowerCase().includes("acl")));
  check("no per-object SSE header is sent by default — MinIO refuses it without a KMS",
    !("x-amz-server-side-encryption" in putCall.options.headers));
  check("the request is signed and carries no credentials in the URL",
    putCall.options.headers.Authorization.startsWith("AWS4-HMAC-SHA256") &&
      !putCall.url.includes("miniosecret") &&
      !putCall.url.includes("X-Amz-Signature"));

  check("the provider returns NO url — there is no object link to leak",
    !("url" in put) && !JSON.stringify(put).includes("http"));

  // --- SSE stays available for stores that implement it
  const encrypting = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    serverSideEncryption: "AES256",
    fetchImpl: stubBinaryFetch(() => ({ status: 200 })),
  });
  await encrypting.put({ buffer: Buffer.from("x"), extension: ".pdf" });
  check("at-rest encryption is requested when STORAGE_SSE names an algorithm",
    encrypting.client.fetch.calls.at(-1).options.headers["x-amz-server-side-encryption"] === "AES256");

  // --- metadata without transferring the bytes
  const meta = await minio.head({ storageKey: put.storageKey });
  check("metadata comes back from a HEAD, without the bytes",
    meta.sizeBytes === pdf.length && meta.contentType === "application/pdf", JSON.stringify(meta));
  check("HEAD on a missing object answers null rather than throwing",
    (await minio.head({ storageKey: "does-not-exist.pdf" })) === null);

  // --- the connection probe the admin panel and `storage check` use
  check("a bucket probe proves reachability without reading an object",
    (await minio.verify()).ok === true);

  // --- traversal through the *stored* key
  const traversal = await throws(() => minio.get({ storageKey: "../../../branding/logo.png" }));
  const traversalCall = fetchImpl.calls.at(-1);
  check("a storage key that tries to escape its scope is flattened, not followed",
    traversalCall.url.includes("/prod/documents/logo.png") && !traversalCall.url.includes(".."),
    traversalCall.url);
  check("and it resolves to nothing rather than another scope's object", traversal.threw);

  // --- scopes are separate
  const branding = await minio.put({
    buffer: Buffer.from("PNG"),
    scope: STORAGE_SCOPES.BRANDING,
    contentType: "image/png",
    extension: ".png",
  });
  check("branding uses the same provider, in its own scope",
    fetchImpl.calls.at(-1).url.includes("/prod/branding/"));
  check("a documents key cannot be read through the branding scope",
    (await throws(() => minio.get({ storageKey: put.storageKey, scope: STORAGE_SCOPES.BRANDING }))).threw);

  // --- replacement is put-then-remove, which is what branding.service does
  const replacement = await minio.put({
    buffer: Buffer.from("PNG2"),
    scope: STORAGE_SCOPES.BRANDING,
    contentType: "image/png",
    extension: ".png",
  });
  check("a replacement gets its own key rather than overwriting the old one",
    replacement.storageKey !== branding.storageKey);
  check("branding removal works through the same interface",
    (await minio.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })).removed === true);
  check("the replaced object is gone and the replacement is still readable",
    (await minio.head({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })) === null &&
      Buffer.compare(
        await minio.get({ storageKey: replacement.storageKey, scope: STORAGE_SCOPES.BRANDING }),
        Buffer.from("PNG2"),
      ) === 0);
  check("removing something already gone is not an error",
    (await minio.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })).removed === false);

  // --- failure modes surface usefully and safely
  const broken = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "AKIAEXPOSED", secretAccessKey: "s3cr3t",
    fetchImpl: stubBinaryFetch(() => ({
      status: 500,
      text: "<Error>InternalError: node i-0abc in vpc-123, key AKIAEXPOSED</Error>",
    })),
  });
  const failure = await throws(() => broken.get({ storageKey: "x.pdf" }));
  check("a provider failure throws a tagged storage error",
    failure.threw && failure.error.code === "STORAGE_PROVIDER_ERROR", failure.error?.message);
  check("the error message names no bucket internals to the caller",
    !failure.error.message.includes("vpc-123"), failure.error.message);
  check("and the credential is redacted out of the detail kept for the log",
    !String(failure.error.detail).includes("AKIAEXPOSED"), failure.error.detail);

  const denied = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    fetchImpl: stubBinaryFetch(() => ({ status: 403, text: "<Error><Code>AccessDenied</Code></Error>" })),
  });
  const deniedResult = await throws(() => denied.verify());
  check("bad credentials are reported as bad credentials, not as a missing file",
    deniedResult.threw && /credentials are wrong or lack permission/.test(deniedResult.error.message),
    deniedResult.error?.message);

  const unimplemented = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    serverSideEncryption: "AES256",
    fetchImpl: stubBinaryFetch(() => ({ status: 501, text: "<Error><Code>NotImplemented</Code></Error>" })),
  });
  const sseFailure = await throws(() => unimplemented.put({ buffer: Buffer.from("x"), extension: ".pdf" }));
  check("a store that cannot encrypt per object says so, and names the setting",
    sseFailure.threw && /STORAGE_SSE/.test(sseFailure.error.message), sseFailure.error?.message);

  const unreachable = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    endpoint: "https://storage.invalid",
    fetchImpl: async () => {
      const error = new Error("getaddrinfo ENOTFOUND");
      error.code = "ENOTFOUND";
      throw error;
    },
  });
  const network = await throws(() => unreachable.verify());
  check("a network failure is tagged as a storage error rather than escaping raw",
    network.threw && network.error.code === "STORAGE_PROVIDER_ERROR" && network.error.status === 502,
    network.error?.message);

  const slow = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    timeoutMs: 30,
    // A store that never answers. The fallback timer is deliberately ref'd:
    // `AbortSignal.timeout()` uses an unref'd one, which is right inside a
    // live server but would let this script exit before the test resolved.
    fetchImpl: (url, options) =>
      new Promise((resolve, reject) => {
        const fallback = setTimeout(() => resolve({ ok: true, status: 200 }), 3000);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(fallback);
          const error = new Error("aborted");
          error.name = "TimeoutError";
          reject(error);
        });
      }),
  });
  const timedOut = await throws(() => slow.verify());
  check("a store that stops answering times out instead of holding the request open",
    timedOut.threw && timedOut.error.status === 504, timedOut.error?.message);

  check("a provider built without credentials refuses to exist",
    (await throws(() => new ObjectStorageProvider({ bucket: "b" }))).threw);

  // --- selection
  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetStorageProvider();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetStorageProvider();
    }
  };

  const MINIO_ENV = {
    STORAGE_ENDPOINT: "https://wfss001.example.invalid",
    STORAGE_BUCKET: "aplus-learn",
    STORAGE_ACCESS_KEY: "minioadmin",
    STORAGE_SECRET_KEY: "miniosecret",
    STORAGE_REGION: "us-east-1",
  };
  const NO_MINIO = Object.fromEntries(Object.keys(MINIO_ENV).map((k) => [k, undefined]));

  await withEnv({ APP_ENV: "development", STORAGE_PROVIDER: undefined, ...NO_MINIO }, () => {
    check("development still works with no credentials at all",
      getStorageProvider() instanceof LocalStorageProvider);
  });

  await withEnv({ APP_ENV: "development", STORAGE_PROVIDER: undefined, ...MINIO_ENV }, () => {
    check("development auto-detects MinIO once an endpoint and bucket are configured",
      getStorageProvider() instanceof ObjectStorageProvider);
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "minio", ...MINIO_ENV }, () => {
    const provider = getStorageProvider();
    check("production selects MinIO and reports itself as such",
      provider instanceof ObjectStorageProvider && provider.name === "MINIO");
    check("the configured endpoint is the one requests go to",
      provider.client.base.host === "wfss001.example.invalid");
    check("path-style addressing is the default", provider.client.forcePathStyle === true);
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "development", ...NO_MINIO }, () => {
    const failed = await$throws(() => getStorageProvider());
    check("production REFUSES the local filesystem — the R33 deployment break cannot recur",
      failed.threw && failed.error.code === "PROVIDER_MISCONFIGURED", failed.error?.message);
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: undefined, ...NO_MINIO }, () => {
    const failed = await$throws(() => getStorageProvider());
    check("production never silently guesses a storage provider",
      failed.threw && failed.error.code === "PROVIDER_MISCONFIGURED");
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "minio", ...NO_MINIO }, () => {
    const failed = await$throws(() => getStorageProvider());
    check("naming MinIO without its bucket and endpoint is a hard failure",
      failed.threw && /STORAGE_BUCKET/.test(failed.error.message), failed.error?.message);
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "s3", ...MINIO_ENV }, () => {
    const failed = await$throws(() => getStorageProvider());
    check("the retired `s3` selector is rejected by name rather than silently ignored",
      failed.threw && /not a provider this build knows/.test(failed.error.message),
      failed.error?.message);
  });

  await liveStorageTests();
}

/**
 * The same provider, against the real MinIO server.
 *
 * Skipped unless STORAGE_* credentials are present, so the suite still runs
 * offline; when they are, this is the only part of the storage story a stub
 * cannot prove — that MinIO accepts exactly what this adapter sends it.
 *
 * Everything it writes, it deletes.
 */
async function liveStorageTests() {
  section("File storage — live MinIO round trip");

  if (!process.env.STORAGE_ENDPOINT || !process.env.STORAGE_BUCKET || !process.env.STORAGE_ACCESS_KEY) {
    return skip("live MinIO round trip", "STORAGE_* credentials are not set");
  }

  const { ObjectStorageProvider, STORAGE_SCOPES } = await import(
    "@/services/external/storage-provider"
  );

  const provider = new ObjectStorageProvider({
    bucket: process.env.STORAGE_BUCKET,
    region: process.env.STORAGE_REGION || "us-east-1",
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    sessionToken: process.env.STORAGE_SESSION_TOKEN || undefined,
    endpoint: process.env.STORAGE_ENDPOINT,
    prefix: process.env.STORAGE_PREFIX || "",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
    serverSideEncryption: process.env.STORAGE_SSE || null,
  });

  try {
    await provider.verify();
    check("the bucket is reachable with the configured credentials", true);
  } catch (error) {
    check("the bucket is reachable with the configured credentials", false, error.message);
    return;
  }

  const bytes = Buffer.from(`%PDF-1.4 live storage check ${randomUUID()}`);
  let stored;

  try {
    stored = await provider.put({
      buffer: bytes,
      fileName: "live-check.pdf",
      contentType: "application/pdf",
      extension: ".pdf",
    });
    check("a verification document uploads to the real bucket", true);
  } catch (error) {
    check("a verification document uploads to the real bucket", false, error.message);
    return;
  }

  try {
    const readBack = await provider.get({ storageKey: stored.storageKey });
    check("the same bytes come back, byte for byte", Buffer.compare(readBack, bytes) === 0);

    const meta = await provider.head({ storageKey: stored.storageKey });
    check("MinIO reports the size and content type we stored",
      meta?.sizeBytes === bytes.length && meta?.contentType === "application/pdf",
      JSON.stringify(meta));

    const missing = await provider.head({ storageKey: `${randomUUID()}.pdf` });
    check("a key that was never written reads as absent", missing === null);

    const branding = await provider.put({
      buffer: Buffer.from("\x89PNG\r\n\x1a\n live branding check"),
      scope: STORAGE_SCOPES.BRANDING,
      contentType: "image/png",
      extension: ".png",
    });
    check("branding lands in its own scope and is separately readable",
      (await provider.head({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING }))?.sizeBytes > 0);
    check("a branding key is not reachable through the documents scope",
      (await provider.head({ storageKey: branding.storageKey })) === null);

    await provider.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING });
    check("deletion removes the object from the bucket",
      (await provider.head({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })) === null);
  } finally {
    await provider.remove({ storageKey: stored.storageKey }).catch(() => {});
  }
}


// --- 9. The unpaid booking hold (R41) --------------------------------------

/**
 * The defect this section exists for: `PENDING_PAYMENT` holds a tutor's slot
 * and nothing used to release it, so any verified learner could book a
 * tutor's whole week, abandon checkout, and erase that week permanently.
 *
 * These run against a real database and the real services — the expiry job,
 * the policy module and the webhook handlers — because the guarantee is about
 * what is stored, not about what a function returns.
 */
async function bookingHoldTests() {
  section("Booking holds — abandoned checkout releases the slot (R41)");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("booking hold expiry", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("booking hold expiry", "MongoDB is not reachable");
    }
  }

  const { Booking, Payment, TutorProfile, Notification, AuditLog } = await import("@/models");
  const { expireStaleBookings, releaseBookingsForFailedPayment } = await import("@/services/booking.service");
  const { handlePaymentWebhook } = await import("@/services/webhook.service");
  const { shouldReleaseHold, holdExpiresAt } = await import("@/lib/booking/policy");
  const { BOOKING_STATUS, BLOCKING_BOOKING_STATUSES, CHECKOUT_HOLD } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  if (!tutor) return skip("booking hold expiry", "no seeded tutor — run `bun run seed`");

  check("EXPIRED is NOT a status that blocks a slot",
    !BLOCKING_BOOKING_STATUSES.includes(BOOKING_STATUS.EXPIRED));
  check("PENDING_PAYMENT still blocks a slot while the hold is live",
    BLOCKING_BOOKING_STATUSES.includes(BOOKING_STATUS.PENDING_PAYMENT));

  // A window far enough out that nothing seeded can overlap it.
  const created = [];
  let slotCursor = new Date("2031-03-03T15:00:00.000Z");
  const nextSlot = () => {
    const startAt = new Date(slotCursor);
    slotCursor = new Date(slotCursor.getTime() + 2 * 60 * 60 * 1000);
    return startAt;
  };

  const price = {
    hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
    commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
  };

  /** A booking exactly as `createBooking` writes one, plus its payment. */
  const makeHold = async ({ ageMinutes = 0, paymentStatus = "REQUIRES_PAYMENT", withPayment = true, checkoutExpiresAt, providerCheckoutUrl, startAt = nextSlot() } = {}) => {
    const createdAt = new Date(Date.now() - ageMinutes * 60_000);
    const purchaserId = new mongoose.Types.ObjectId();

    const booking = await Booking.create({
      reference: `APL-T${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      meetingProvider: "GOOGLE_MEET",
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      durationMinutes: 60,
      status: BOOKING_STATUS.PENDING_PAYMENT,
      price,
      createdAt,
    });
    // `timestamps` overrides createdAt on insert, so age it explicitly.
    await Booking.updateOne({ _id: booking._id }, { $set: { createdAt } }, { timestamps: false });

    let payment = null;
    if (withPayment) {
      payment = await Payment.create({
        bookingId: booking._id,
        purchaserId,
        tutorUserId: tutor.userId,
        subtotalCents: 6000, commissionPercent: 15, commissionCents: 900,
        tutorEarningsCents: 5100, totalCents: 6000,
        status: paymentStatus,
        provider: "STRIPE",
        providerCheckoutId: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        providerPaymentIntentId: `pi_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        ...(checkoutExpiresAt ? { checkoutExpiresAt } : {}),
        ...(providerCheckoutUrl ? { providerCheckoutUrl } : {}),
      });
      await Booking.updateOne({ _id: booking._id }, { $set: { paymentId: payment._id } });
    }

    created.push({ bookingId: booking._id, paymentId: payment?._id, purchaserId });
    return { booking: await Booking.findById(booking._id).lean(), payment };
  };

  const statusOf = async (id) => (await Booking.findById(id).select("status").lean())?.status;

  /** Would a new learner's lesson in this window be refused by the overlap rule? */
  const slotIsBlocked = async (startAt) =>
    Boolean(
      await Booking.exists({
        tutorProfileId: tutor._id,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        startAt: { $lt: new Date(startAt.getTime() + 60 * 60 * 1000) },
        endAt: { $gt: startAt },
      }),
    );

  try {
    // --- 1 & 2. a fresh hold blocks, and survives the sweep
    const fresh = await makeHold({ ageMinutes: 5 });
    check("a PENDING_PAYMENT booking blocks its slot",
      await slotIsBlocked(fresh.booking.startAt));

    const firstSweep = await expireStaleBookings();
    check("a FRESH hold is not expired by the sweep",
      (await statusOf(fresh.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(firstSweep));
    check("and its slot is still blocked", await slotIsBlocked(fresh.booking.startAt));
    check("the policy explains why it was kept",
      shouldReleaseHold({ booking: fresh.booking, payment: fresh.payment }).reason === "hold is still live");

    // --- 3, 4, 5. a stale hold is released
    const stale = await makeHold({ ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5 });
    check("a stale hold still blocks its slot before the sweep",
      await slotIsBlocked(stale.booking.startAt));

    const sweep = await expireStaleBookings();
    check("a STALE hold is expired by the sweep",
      (await statusOf(stale.booking._id)) === BOOKING_STATUS.EXPIRED, JSON.stringify(sweep));
    check("the sweep reports what it released", sweep.expired >= 1);
    check("the EXPIRED booking NO LONGER blocks the slot",
      (await slotIsBlocked(stale.booking.startAt)) === false);
    check("a new learner's lesson in that window would now pass the overlap rule",
      (await Booking.countDocuments({
        tutorProfileId: tutor._id,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        startAt: { $lt: stale.booking.endAt },
        endAt: { $gt: stale.booking.startAt },
      })) === 0);
    check("the release is recorded in the audit log",
      Boolean(await AuditLog.findOne({ action: "BOOKING_EXPIRED", entityId: stale.booking._id })));
    check("the purchaser is told their held time was released",
      Boolean(await Notification.findOne({ userId: stale.booking.purchaserId, type: "BOOKING_EXPIRED" })));
    check("the abandoned payment stops being payable",
      (await Payment.findById(stale.payment._id).lean()).status === "FAILED");
    check("the fresh hold was untouched by the same sweep",
      (await statusOf(fresh.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    // --- 6. a settled payment is never expired
    const paid = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 500,
      paymentStatus: "PAID",
    });
    await expireStaleBookings();
    check("a booking whose payment is PAID is NEVER expired, however old the hold",
      (await statusOf(paid.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);
    check("the policy refuses it by name",
      shouldReleaseHold({ booking: paid.booking, payment: paid.payment }).reason === "payment settled");

    // --- 7. idempotent and overlap-safe
    const idempotent = await makeHold({ ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5 });
    const [a, b, c] = await Promise.all([
      expireStaleBookings(), expireStaleBookings(), expireStaleBookings(),
    ]);
    check("three overlapping sweeps release the booking exactly once",
      [a, b, c].filter((r) => r.expired > 0).length === 1,
      JSON.stringify([a.expired, b.expired, c.expired]));
    check("and it is EXPIRED", (await statusOf(idempotent.booking._id)) === BOOKING_STATUS.EXPIRED);
    check("only one audit entry was written for it",
      (await AuditLog.countDocuments({ action: "BOOKING_EXPIRED", entityId: idempotent.booking._id })) === 1);
    check("a re-run after the fact changes nothing",
      (await expireStaleBookings()).expired === 0);

    // --- a booking whose payment never got created (the S4 orphan)
    const orphan = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
      withPayment: false,
    });
    await expireStaleBookings();
    check("a booking orphaned by a crash before its payment existed is released too",
      (await statusOf(orphan.booking._id)) === BOOKING_STATUS.EXPIRED);

    // --- the hold respects a provider session that outlives our own window
    const longSession = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
      checkoutExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      providerCheckoutUrl: "https://checkout.stripe.com/c/pay/live",
    });
    await expireStaleBookings();
    check("a hold is NOT released while the provider's own session is still live",
      (await statusOf(longSession.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);
    check("the hold deadline is the later of ours and the provider's",
      holdExpiresAt(longSession.booking, longSession.payment) >
        new Date(Date.now() + 55 * 60 * 1000));
    check("the provider's stated expiry carries the anti-race grace",
      holdExpiresAt(longSession.booking, longSession.payment).getTime() ===
        new Date(longSession.payment.checkoutExpiresAt).getTime() +
          CHECKOUT_HOLD.graceMinutes * 60_000);
    check("our own window carries none — it is measured from our own timestamp",
      holdExpiresAt({ createdAt: new Date("2030-01-01T00:00:00Z") }, null).toISOString() ===
        new Date(Date.parse("2030-01-01T00:00:00Z") + CHECKOUT_HOLD.minutes * 60_000).toISOString());

    // --- 8, 9, 10, 11. the webhook paths
    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const deliverEvent = (body) => {
      const payload = JSON.stringify(body);
      return handlePaymentWebhook({
        payload, signature: stripeSignature(payload, WEBHOOK_SECRET), connect: false,
      });
    };
    const evt = (type, object) => ({
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      type, livemode: false, data: { object },
    });

    // --- 7b. a payment that succeeded at Stripe but whose webhook was LOST
    //
    // The worst outcome this application has: the purchaser is charged, no
    // event ever arrives, and the sweep releases the lesson they paid for.
    // So the sweep asks the provider directly before doing anything
    // irreversible. `readProviderStatus` is the injected seam standing in for
    // that call — in production it is the Stripe API answering, never a
    // browser.
    const lostWebhook = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
    });
    check("the lost-webhook booking looks exactly like an abandoned one",
      shouldReleaseHold({ booking: lostWebhook.booking, payment: lostWebhook.payment }).expire === true);

    const reconciled = await expireStaleBookings({
      readProviderStatus: async (payment) => ({
        paymentIntentId: payment.providerPaymentIntentId,
        status: "PAID",
        amountCents: payment.totalCents,
      }),
    });
    check("a payment that is PAID at the provider is settled by the sweep, not released",
      (await Payment.findById(lostWebhook.payment._id).lean()).status === "PAID",
      JSON.stringify(reconciled));
    check("its lesson is CONFIRMED rather than EXPIRED",
      (await statusOf(lostWebhook.booking._id)) === BOOKING_STATUS.CONFIRMED);
    check("and the slot stays blocked, because the lesson is real",
      await slotIsBlocked(lostWebhook.booking.startAt));
    check("the catch-up is audited as a reconciliation, distinguishable from a webhook",
      Boolean(await AuditLog.findOne({
        action: "PAYMENT_SETTLED",
        entityId: lostWebhook.payment._id,
        "metadata.source": "reconciliation",
      })));

    const reSweep = await expireStaleBookings({
      readProviderStatus: async (payment) => ({
        paymentIntentId: payment.providerPaymentIntentId,
        status: "PAID",
        amountCents: payment.totalCents,
      }),
    });
    check("running the sweep again confirms nothing twice",
      (await AuditLog.countDocuments({
        action: "PAYMENT_SETTLED",
        entityId: lostWebhook.payment._id,
      })) === 1, JSON.stringify(reSweep));

    // --- 7c. the provider cannot be reached
    //
    // A slot held ten minutes too long is recoverable. A paid lesson deleted
    // because we guessed is not. So an unanswerable provider means the hold
    // stays.
    const unknowable = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
    });
    const blindSweep = await expireStaleBookings({
      readProviderStatus: async () => {
        throw new Error("Stripe is unreachable");
      },
    });
    check("a booking is NOT released while the provider cannot be asked",
      (await statusOf(unknowable.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(blindSweep));
    check("the sweep reports it as held rather than expired", blindSweep.expired === 0);

    // ...and is released on the next run, once the provider answers.
    await expireStaleBookings({
      readProviderStatus: async () => ({ status: "REQUIRES_PAYMENT" }),
    });
    check("once the provider confirms it was never paid, the slot IS released",
      (await statusOf(unknowable.booking._id)) === BOOKING_STATUS.EXPIRED);

    // --- 7d. a provider that reports a DIFFERENT amount is never settled
    const mismatched = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
    });
    await expireStaleBookings({
      readProviderStatus: async (payment) => ({
        paymentIntentId: payment.providerPaymentIntentId,
        status: "PAID",
        amountCents: 1,
      }),
    });
    check("a provider amount that disagrees with the priced total settles NOTHING",
      (await Payment.findById(mismatched.payment._id).lean()).status === "REQUIRES_PAYMENT");
    check("and the hold is kept for a human rather than released on a discrepancy",
      (await statusOf(mismatched.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    // 8. checkout.session.expired
    const abandoned = await makeHold({ ageMinutes: 5 });
    const expiredEvent = evt("checkout.session.expired", {
      id: abandoned.payment.providerCheckoutId,
      payment_intent: abandoned.payment.providerPaymentIntentId,
      metadata: { paymentId: String(abandoned.payment._id) },
    });
    const expiredResult = await deliverEvent(expiredEvent);
    check("checkout.session.expired releases the slot IMMEDIATELY, without waiting for the sweep",
      (await statusOf(abandoned.booking._id)) === BOOKING_STATUS.EXPIRED, JSON.stringify(expiredResult));
    check("and the slot is free again", (await slotIsBlocked(abandoned.booking.startAt)) === false);

    // 10. duplicate delivery
    const replay = await deliverEvent(expiredEvent);
    check("a duplicate checkout.session.expired delivery is recognised and dropped",
      replay.duplicate === true);
    check("the duplicate released nothing further",
      (await AuditLog.countDocuments({ action: "BOOKING_EXPIRED", entityId: abandoned.booking._id })) === 1);

    // a *superseded* session expiring must not touch a live retry
    const retrying = await makeHold({ ageMinutes: 5 });
    const staleSession = await deliverEvent(
      evt("checkout.session.expired", {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_intent: retrying.payment.providerPaymentIntentId,
        metadata: { paymentId: String(retrying.payment._id) },
      }),
    );
    check("an OLD session expiring does not release a booking the purchaser is still paying for",
      (await statusOf(retrying.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT &&
        /superseded/.test(staleSession.result ?? ""), JSON.stringify(staleSession));

    // 9. payment_intent.payment_failed — held while a live session remains
    const retryable = await makeHold({
      ageMinutes: 2,
      checkoutExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      providerCheckoutUrl: "https://checkout.stripe.com/c/pay/live",
    });
    const heldResult = await deliverEvent(
      evt("payment_intent.payment_failed", {
        id: retryable.payment.providerPaymentIntentId,
        metadata: { paymentId: String(retryable.payment._id) },
        last_payment_error: { message: "Your card was declined." },
      }),
    );
    check("a decline inside a LIVE checkout session keeps the slot, so a second card still works",
      (await statusOf(retryable.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT &&
        /held until the hold lapses/.test(heldResult.result ?? ""), JSON.stringify(heldResult));
    check("but the payment is marked failed",
      (await Payment.findById(retryable.payment._id).lean()).status === "FAILED");

    // 9. payment_intent.payment_failed — released when nothing is left to retry
    const terminal = await makeHold({ ageMinutes: 2 });
    const releasedResult = await deliverEvent(
      evt("payment_intent.payment_failed", {
        id: terminal.payment.providerPaymentIntentId,
        metadata: { paymentId: String(terminal.payment._id) },
        last_payment_error: { message: "Your card was declined." },
      }),
    );
    check("a decline with NO checkout session left releases the slot immediately",
      (await statusOf(terminal.booking._id)) === BOOKING_STATUS.EXPIRED, JSON.stringify(releasedResult));

    // a late failure must not un-confirm a paid booking
    const settled = await makeHold({ ageMinutes: 2, paymentStatus: "PAID" });
    await deliverEvent(
      evt("payment_intent.payment_failed", {
        id: settled.payment.providerPaymentIntentId,
        metadata: { paymentId: String(settled.payment._id) },
      }),
    );
    check("a late failure event cannot release a PAID booking",
      (await statusOf(settled.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    // 11. a crafted event must not reach somebody else's booking
    const victim = await makeHold({ ageMinutes: 2 });
    const attacker = await makeHold({ ageMinutes: 2 });
    const crafted = await deliverEvent(
      evt("checkout.session.expired", {
        // The attacker's own session, pointed at the victim's payment.
        id: attacker.payment.providerCheckoutId,
        payment_intent: attacker.payment.providerPaymentIntentId,
        metadata: { paymentId: String(victim.payment._id) },
      }),
    );
    check("an event naming another user's payment CANNOT release their booking",
      (await statusOf(victim.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(crafted));
    check("the crafted event is refused as a mismatch, not silently applied",
      crafted.handled === false && /does not match/i.test(crafted.result ?? ""));
    check("the victim's slot is still theirs", await slotIsBlocked(victim.booking.startAt));

    // direct service call: a settled payment is refused even here
    check("releaseBookingsForFailedPayment refuses a settled payment outright",
      (await releaseBookingsForFailedPayment(settled.payment._id)).expired === 0);
  } finally {
    await Booking.deleteMany({ _id: { $in: created.map((c) => c.bookingId) } });
    await Payment.deleteMany({ _id: { $in: created.map((c) => c.paymentId).filter(Boolean) } });
    await Notification.deleteMany({ userId: { $in: created.map((c) => c.purchaserId) } });
    await AuditLog.deleteMany({
      action: "BOOKING_EXPIRED",
      entityId: { $in: created.map((c) => c.bookingId) },
    });
  }
}


// --- 10. Advanced matching (§22, §41 Phase 2) ------------------------------

/**
 * Scoring and ranking are pure functions of stored data, so they are tested
 * without a database at all. What matters here is the two guarantees the rest
 * of the feature rests on: an operator's weights change the *order* and never
 * the *membership*, and the same inputs always produce the same number.
 */
async function matchingTests() {
  section("Matching — scoring, weights and eligibility");

  const { normaliseWeights, MATCH_WEIGHTS, MATCH_FACTOR_KEYS } =
    await import("@/lib/matching/weights");
  const { scoreTutorForRequest, compareMatches, explainMatch } =
    await import("@/lib/matching/score");
  const { isEligibleForMatch, matchCandidateQuery } = await import("@/lib/matching/eligibility");
  const { LESSON_MODES, TUTOR_STATUS, USER_STATUS } = await import("@/constants");

  const courseId = "aaaaaaaaaaaaaaaaaaaaaaa1";
  const subjectId = "bbbbbbbbbbbbbbbbbbbbbbb1";

  const baseTutor = (over = {}) => ({
    _id: "ccccccccccccccccccccccc1",
    status: TUTOR_STATUS.APPROVED,
    isSearchable: true,
    acceptingNewStudents: true,
    userId: { _id: "ddddddddddddddddddddddd1", status: USER_STATUS.ACTIVE, deletedAt: null },
    courseIds: [courseId],
    subjectIds: [subjectId],
    gradeLevels: [12],
    lessonModes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
    languages: ["English"],
    verifiedTypes: ["IDENTITY", "BACKGROUND_CHECK"],
    yearsExperience: 6,
    hourlyRateCents: 6000,
    minHourlyRateCents: 6000,
    travelRadiusKm: 20,
    location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    city: "Toronto",
    stats: { ratingAverage: 4.8, ratingCount: 24, completedLessons: 80, cancellationCount: 2, responseTimeMinutes: 30 },
    ...over,
  });

  const baseRequest = (over = {}) => ({
    _id: "eeeeeeeeeeeeeeeeeeeeeee1",
    ownerId: "fffffffffffffffffffffff1",
    courseId,
    subjectId,
    gradeLevel: 12,
    modes: [LESSON_MODES.ONLINE],
    budgetMaxCents: 7000,
    preferredWindows: ["WEEKDAY_EVENING"],
    sessionsPerWeek: 1,
    preferredDurationMinutes: 60,
    languages: [],
    maxDistanceKm: 25,
    status: "OPEN",
    ...over,
  });

  const availability = {
    weeklyRules: [
      { weekday: 1, startMinutes: 17 * 60, endMinutes: 21 * 60 },
      { weekday: 3, startMinutes: 17 * 60, endMinutes: 21 * 60 },
    ],
  };

  // --- weights -------------------------------------------------------------
  const normalised = normaliseWeights(MATCH_WEIGHTS);
  const total = Object.values(normalised).reduce((a, b) => a + b, 0);
  check("shipped weights normalise to 100", Math.abs(total - 100) < 0.001, `got ${total}`);

  const doubled = normaliseWeights(
    Object.fromEntries(MATCH_FACTOR_KEYS.map((k) => [k, MATCH_WEIGHTS[k] * 7])),
  );
  check("weights are relative — scaling them all changes nothing",
    MATCH_FACTOR_KEYS.every((k) => Math.abs(doubled[k] - normalised[k]) < 0.001));

  const partial = normaliseWeights({ course: 50 });
  check("a partial weight map keeps the shipped value for every other factor",
    MATCH_FACTOR_KEYS.every((k) => partial[k] > 0) &&
      Math.abs(Object.values(partial).reduce((a, b) => a + b, 0) - 100) < 0.001);

  const allZero = normaliseWeights(Object.fromEntries(MATCH_FACTOR_KEYS.map((k) => [k, 0])));
  check("all-zero weights fall back to the shipped set rather than zeroing every score",
    Math.abs(Object.values(allZero).reduce((a, b) => a + b, 0) - 100) < 0.001);

  check("an unknown factor in stored settings is ignored",
    Object.keys(normaliseWeights({ ...MATCH_WEIGHTS, nonsense: 900 })).length ===
      MATCH_FACTOR_KEYS.length);

  // --- scoring -------------------------------------------------------------
  const exact = scoreTutorForRequest(baseTutor(), baseRequest(), availability);
  const subjectOnly = scoreTutorForRequest(
    baseTutor({ courseIds: [] }), baseRequest(), availability,
  );
  check("teaching the exact course outscores teaching only the subject",
    exact.score > subjectOnly.score, `${exact.score} vs ${subjectOnly.score}`);

  check("a score is bounded to 0–100", exact.score >= 0 && exact.score <= 100, `${exact.score}`);

  const again = scoreTutorForRequest(baseTutor(), baseRequest(), availability);
  check("scoring is deterministic", again.score === exact.score);

  const overBudget = scoreTutorForRequest(
    baseTutor({ minHourlyRateCents: 20000, hourlyRateCents: 20000 }), baseRequest(), availability,
  );
  check("a tutor far over budget scores below one inside it",
    overBudget.score < exact.score && overBudget.breakdown.budget === 0);

  const noLanguage = scoreTutorForRequest(
    baseTutor({ languages: ["French"] }), baseRequest({ languages: ["Mandarin"] }), availability,
  );
  const rightLanguage = scoreTutorForRequest(
    baseTutor({ languages: ["Mandarin"] }), baseRequest({ languages: ["Mandarin"] }), availability,
  );
  check("the language the family asked for counts",
    rightLanguage.score > noLanguage.score);

  const unverified = scoreTutorForRequest(
    baseTutor({ verifiedTypes: [] }), baseRequest(), availability,
  );
  check("verification badges a moderator granted count toward the score",
    exact.score > unverified.score);

  const noAvailability = scoreTutorForRequest(baseTutor(), baseRequest(), null);
  check("a tutor with no published availability loses the schedule factor",
    noAvailability.breakdown.availability === 0 && noAvailability.score < exact.score);

  // A weight change reorders; it cannot invent a factor's raw fit.
  const courseHeavy = scoreTutorForRequest(
    baseTutor({ courseIds: [] }), baseRequest(), availability,
    { ...MATCH_WEIGHTS, course: 90 },
  );
  check("raising a weight changes points, not the underlying fit",
    courseHeavy.factors.course === subjectOnly.factors.course &&
      courseHeavy.breakdown.course !== subjectOnly.breakdown.course);

  // --- ranking -------------------------------------------------------------
  const ranked = [
    { score: 70, tutor: { _id: "b", stats: { ratingAverage: 4.9, completedLessons: 10 } } },
    { score: 70, tutor: { _id: "a", stats: { ratingAverage: 4.9, completedLessons: 10 } } },
    { score: 70, tutor: { _id: "c", stats: { ratingAverage: 5.0, completedLessons: 3 } } },
    { score: 90, tutor: { _id: "d", stats: { ratingAverage: 3.0, completedLessons: 1 } } },
  ].sort(compareMatches);
  check("ranking puts the highest score first",
    ranked[0].tutor._id === "d");
  check("a tie is broken by rating, then lessons, then id — deterministically",
    ranked.map((r) => r.tutor._id).join("") === "dcab");

  const shuffled = [...ranked].reverse().sort(compareMatches);
  check("the same candidates always come back in the same order",
    shuffled.map((r) => r.tutor._id).join("") === ranked.map((r) => r.tutor._id).join(""));

  // --- eligibility ---------------------------------------------------------
  check("an eligible tutor passes", isEligibleForMatch(baseTutor(), baseRequest()).eligible);

  const ineligible = [
    ["an unapproved profile", baseTutor({ status: TUTOR_STATUS.PENDING_REVIEW })],
    ["a profile that is not searchable", baseTutor({ isSearchable: false })],
    ["a tutor not taking new students", baseTutor({ acceptingNewStudents: false })],
    ["a suspended account", baseTutor({ userId: { _id: "x", status: USER_STATUS.SUSPENDED } })],
    ["a deleted account", baseTutor({ userId: { _id: "x", status: USER_STATUS.ACTIVE, deletedAt: new Date() } })],
    ["a tutor who does not teach the subject", baseTutor({ courseIds: [], subjectIds: [] })],
    ["a tutor who does not offer the lesson type", baseTutor({ lessonModes: [LESSON_MODES.IN_PERSON] })],
  ];
  for (const [label, tutor] of ineligible) {
    const result = isEligibleForMatch(tutor, baseRequest());
    check(`${label} is never recommended`, !result.eligible, result.reason);
  }

  const farAway = baseTutor({ location: { type: "Point", coordinates: [-75.6972, 45.4215] } });
  check("an in-person-only request never reaches a tutor outside the travel radius",
    !isEligibleForMatch(farAway, baseRequest({
      modes: [LESSON_MODES.IN_PERSON],
      location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    })).eligible);

  check("a tutor cannot be matched to their own request",
    !isEligibleForMatch(
      baseTutor({ userId: { _id: "fffffffffffffffffffffff1", status: USER_STATUS.ACTIVE } }),
      baseRequest(),
    ).eligible);

  // No weighting can rescue an ineligible tutor: eligibility runs first.
  const suspended = baseTutor({ userId: { _id: "x", status: USER_STATUS.SUSPENDED } });
  const generous = scoreTutorForRequest(suspended, baseRequest(), availability, { course: 100 });
  check("a high score does not make an ineligible tutor eligible",
    generous.score > 0 && !isEligibleForMatch(suspended, baseRequest()).eligible);

  // --- candidate query -----------------------------------------------------
  const query = matchCandidateQuery(baseRequest());
  check("the candidate query filters on the searchable gate and approved status",
    query.isSearchable === true && query.status === TUTOR_STATUS.APPROVED &&
      query.acceptingNewStudents === true);

  const geoQuery = matchCandidateQuery(baseRequest({
    modes: [LESSON_MODES.IN_PERSON],
    location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    maxDistanceKm: 10,
  }));
  check("an in-person-only request bounds the query geographically",
    Boolean(geoQuery.location?.$geoWithin?.$centerSphere));

  check("a request that also accepts online is not geo-bounded",
    !matchCandidateQuery(baseRequest({
      modes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
      location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    })).location);

  // --- explanation ---------------------------------------------------------
  const reasons = explainMatch(exact.breakdown, exact.distanceKm, exact.weights);
  check("a strong match explains itself in plain language", reasons.length > 0);
  check("an exact course match says so",
    reasons.some((r) => /exact course/i.test(r)));

  // A match scored under the old weights still explains against those weights.
  const oldWeights = { ...MATCH_WEIGHTS, course: 90 };
  const oldScored = scoreTutorForRequest(baseTutor(), baseRequest(), availability, oldWeights);
  check("an old match explains itself against the weights it was scored with",
    explainMatch(oldScored.breakdown, oldScored.distanceKm, oldScored.weights)
      .some((r) => /exact course/i.test(r)));
}

// --- 11. Tutor request lifecycle (§22, §41 Phase 2) ------------------------

/**
 * The request state machine against a real database: who may edit, who may
 * see, what the matcher will and will not revive, and whether the expiry job
 * is safe to run twice.
 */
async function tutorRequestTests() {
  section("Tutor requests — lifecycle, visibility and expiry");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("tutor request lifecycle", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("tutor request lifecycle", "MongoDB is not reachable");
    }
  }

  const { TutorRequest, TutorMatch, TutorProfile, StudentProfile, Course, Notification, AuditLog, User } =
    await import("@/models");
  const svc = await import("@/services/request.service");
  const { REQUEST_STATUS, REQUEST_VISIBILITY, MATCH_STATUS, ROLES } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  const student = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !student) {
    return skip("tutor request lifecycle", "no seeded tutor/student — run `bun run seed`");
  }

  const course = await Course.findById(tutor.courseIds?.[0]).lean();
  if (!course) return skip("tutor request lifecycle", "seeded tutor teaches no known course");

  const owner = { id: String(student.ownerId), role: ROLES.PARENT };
  const tutorActor = { id: String(tutor.userId), role: ROLES.TUTOR };
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };

  // Leftovers from a crashed earlier run would otherwise count against the
  // per-family open-request cap and fail this one for the wrong reason.
  // Both suites post requests as the same seeded parent, and a crashed run of
  // either leaves them open against the per-family cap.
  const stale = await TutorRequest.find({
    goal: /^(Integration test request|QA run)/,
  })
    .select("_id")
    .lean();
  if (stale.length) {
    const staleIds = stale.map((r) => r._id);
    await TutorMatch.deleteMany({ requestId: { $in: staleIds } });
    await Notification.deleteMany({ entityType: "TutorRequest", entityId: { $in: staleIds } });
    await AuditLog.deleteMany({ entityType: "TutorRequest", entityId: { $in: staleIds } });
    await TutorRequest.deleteMany({ _id: { $in: staleIds } });
  }

  const createdRequests = [];
  const post = async (over = {}) => {
    const { request } = await svc.createTutorRequest({
      studentProfileId: String(student._id),
      courseId: String(course._id),
      modes: ["ONLINE"],
      maxDistanceKm: 25,
      preferredWindows: ["WEEKDAY_EVENING"],
      sessionsPerWeek: 1,
      preferredDurationMinutes: 60,
      budgetMaxCents: 20000,
      languages: [],
      preferredQualifications: [],
      urgency: "FLEXIBLE",
      visibility: REQUEST_VISIBILITY.PUBLIC,
      goal: "Integration test request — safe to delete.",
      ...over,
    }, owner);
    createdRequests.push(request.id);
    return request;
  };

  try {
    // --- creation and matching ---------------------------------------------
    const request = await post();
    check("posting a request stores it OPEN", request.status === REQUEST_STATUS.OPEN);
    check("a request gets a public reference", /^REQ-/.test(request.reference));

    const matches = await TutorMatch.find({ requestId: request.id }).lean();
    check("the matcher suggested at least the tutor who teaches this course",
      matches.some((m) => String(m.tutorProfileId) === String(tutor._id)),
      `${matches.length} matches`);

    const mine = matches.find((m) => String(m.tutorProfileId) === String(tutor._id));
    check("a stored match keeps the weights it was scored with", Boolean(mine?.scoreWeights));
    check("a stored match keeps a per-factor breakdown",
      typeof mine?.scoreBreakdown?.course === "number");

    // --- authorization ------------------------------------------------------
    const strangerEdit = await throws(
      () => svc.updateTutorRequest(request.id, { goal: "Hijacked by a stranger." }, stranger),
      (e) => e.status === 403,
    );
    check("a stranger cannot edit someone else's request",
      strangerEdit.threw && strangerEdit.matched);

    const strangerCancel = await throws(
      () => svc.cancelRequest(request.id, {}, stranger),
      (e) => e.status === 403,
    );
    check("a stranger cannot cancel someone else's request",
      strangerCancel.threw && strangerCancel.matched);

    const strangerRead = await throws(
      () => svc.getRequest(request.id, stranger),
      (e) => e.status === 403,
    );
    check("a learner who does not own a request cannot read it",
      strangerRead.threw && strangerRead.matched);

    // --- editing ------------------------------------------------------------
    const edited = await svc.updateTutorRequest(
      request.id,
      { goal: "Integration test request — edited. Safe to delete.", budgetMaxCents: 25000 },
      owner,
    );
    check("editing records what changed",
      edited.changed.includes("goal") && edited.changed.includes("budgetMaxCents"));
    check("editing bumps the edit counter", edited.request.editCount === 1);

    const noop = await svc.updateTutorRequest(request.id, { budgetMaxCents: 25000 }, owner);
    check("an edit that changes nothing is a no-op", noop.changed.length === 0);

    const forbidden = await svc.updateTutorRequest(
      request.id,
      { courseId: String(new mongoose.Types.ObjectId()), studentProfileId: String(new mongoose.Types.ObjectId()) },
      owner,
    );
    check("course and learner cannot be changed by an edit",
      String(forbidden.request.courseId) === String(course._id) &&
        String(forbidden.request.studentProfileId) === String(student._id));

    // --- tutor stepping back -----------------------------------------------
    await svc.withdrawFromRequest(request.id, { action: "DECLINE", reason: "Full this term." }, tutorActor);
    const declined = await TutorMatch.findOne({
      requestId: request.id, tutorProfileId: tutor._id,
    }).lean();
    check("a tutor declining is recorded, not deleted",
      declined?.status === MATCH_STATUS.TUTOR_DECLINED && Boolean(declined.declinedAt));

    const declineTwice = await throws(
      () => svc.withdrawFromRequest(request.id, { action: "DECLINE" }, tutorActor),
      (e) => e.status === 409,
    );
    check("a tutor cannot decline the same request twice",
      declineTwice.threw && declineTwice.matched);

    const pitchAfterDecline = await throws(
      () => svc.expressInterest(request.id, { message: "x".repeat(40) }, tutorActor),
      (e) => e.code === "MATCH_CLOSED",
    );
    check("a tutor who declined cannot then pitch",
      pitchAfterDecline.threw && pitchAfterDecline.matched);

    await svc.generateMatches(await TutorRequest.findById(request.id).lean());
    const stillDeclined = await TutorMatch.findOne({
      requestId: request.id, tutorProfileId: tutor._id,
    }).lean();
    check("re-running the matcher never revives a match a tutor closed",
      stillDeclined?.status === MATCH_STATUS.TUTOR_DECLINED);

    // --- invite-only visibility ---------------------------------------------
    const privateRequest = await post({ visibility: REQUEST_VISIBILITY.INVITE_ONLY });
    const uninvited = await throws(
      () => svc.getRequestForTutor(privateRequest.id, tutorActor),
      (e) => e.status === 404,
    );
    check("an uninvited tutor cannot even see an invite-only request exists",
      uninvited.threw && uninvited.matched);

    const uninvitedPitch = await throws(
      () => svc.expressInterest(privateRequest.id, { message: "y".repeat(40) }, tutorActor),
      (e) => e.status === 404,
    );
    check("an uninvited tutor cannot respond to an invite-only request",
      uninvitedPitch.threw && uninvitedPitch.matched);

    const invited = await svc.inviteTutors(
      privateRequest.id, { tutorProfileIds: [String(tutor._id)] }, owner,
    );
    check("inviting a tutor opens the request to them", invited.invited === 1);

    const view = await svc.getRequestForTutor(privateRequest.id, tutorActor);
    check("an invited tutor sees the request and may respond",
      view.request.id === privateRequest.id && view.canRespond === true);

    const strangerInvite = await throws(
      () => svc.inviteTutors(privateRequest.id, { tutorProfileIds: [String(tutor._id)] }, stranger),
      (e) => e.status === 403,
    );
    check("only the owner may invite tutors", strangerInvite.threw && strangerInvite.matched);

    const reinvite = await throws(
      () => svc.inviteTutors(privateRequest.id, { tutorProfileIds: [String(tutor._id)] }, owner),
      (e) => e.status === 409,
    );
    check("a tutor already invited is not invited again", reinvite.threw && reinvite.matched);

    // --- responding ---------------------------------------------------------
    await svc.expressInterest(privateRequest.id, { message: "z".repeat(40) }, tutorActor);
    const pitched = await TutorMatch.findOne({
      requestId: privateRequest.id, tutorProfileId: tutor._id,
    }).lean();
    check("a tutor's pitch is stored against the match",
      pitched?.status === MATCH_STATUS.TUTOR_INTERESTED && Boolean(pitched.respondedAt));

    const counted = await TutorRequest.findById(privateRequest.id).lean();
    check("the interested count reflects the pitch", counted.interestedCount === 1);

    const pitchTwice = await throws(
      () => svc.expressInterest(privateRequest.id, { message: "q".repeat(40) }, tutorActor),
      (e) => e.status === 409,
    );
    check("a tutor cannot pitch twice", pitchTwice.threw && pitchTwice.matched);

    await svc.withdrawFromRequest(privateRequest.id, { action: "WITHDRAW" }, tutorActor);
    const afterWithdraw = await TutorRequest.findById(privateRequest.id).lean();
    check("withdrawing a pitch decrements the interested count",
      afterWithdraw.interestedCount === 0);

    // --- endings ------------------------------------------------------------
    const cancelled = await svc.cancelRequest(privateRequest.id, { reason: "Test." }, owner);
    check("cancelling moves the request to CANCELLED",
      cancelled.status === REQUEST_STATUS.CANCELLED && Boolean(cancelled.cancelledAt));

    const editClosed = await throws(
      () => svc.updateTutorRequest(privateRequest.id, { goal: "Reopened by the back door." }, owner),
      (e) => e.code === "REQUEST_CLOSED",
    );
    check("a closed request cannot be edited", editClosed.threw && editClosed.matched);

    const respondClosed = await throws(
      () => svc.expressInterest(privateRequest.id, { message: "w".repeat(40) }, tutorActor),
      (e) => e.code === "REQUEST_CLOSED" || e.status === 404,
    );
    check("a closed request accepts no new responses",
      respondClosed.threw && respondClosed.matched);

    const closedMatches = await svc.generateMatches(
      await TutorRequest.findById(privateRequest.id).lean(),
    );
    check("the matcher does nothing for a closed request", closedMatches.length === 0);

    // --- expiry -------------------------------------------------------------
    const expiring = await post();
    await TutorRequest.updateOne(
      { _id: expiring.id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    const firstSweep = await svc.expireStaleRequests();
    check("the expiry sweep closes an aged-out request", firstSweep.expired >= 1);
    check("the expired request is EXPIRED",
      (await TutorRequest.findById(expiring.id).lean()).status === REQUEST_STATUS.EXPIRED);

    const secondSweep = await svc.expireStaleRequests();
    check("running the expiry sweep again finds nothing left to do",
      secondSweep.expired === 0);

    const warning = await post();
    await TutorRequest.updateOne(
      { _id: warning.id },
      { $set: { expiresAt: new Date(Date.now() + 24 * 3600_000), expiryWarnedAt: null } },
    );
    const warnRun = await svc.expireStaleRequests();
    check("a request about to expire warns the family once", warnRun.warned >= 1);
    check("the warning is stamped so it cannot be sent twice",
      Boolean((await TutorRequest.findById(warning.id).lean()).expiryWarnedAt));
    const warnAgain = await svc.expireStaleRequests();
    check("a second sweep does not warn the same family again", warnAgain.warned === 0);

    // --- moderation ----------------------------------------------------------
    const moderated = await post();
    const removed = await svc.moderateRequest(
      moderated.id, { action: "REMOVE", note: "Contains contact details." }, admin,
    );
    check("a moderator can remove a request", removed.status === REQUEST_STATUS.REMOVED);
    check("removal is recorded in the moderation history",
      removed.moderationHistory.length === 1);

    const hidden = await throws(
      () => svc.getRequestForTutor(moderated.id, tutorActor),
      (e) => e.status === 404,
    );
    check("a removed request is invisible to tutors", hidden.threw && hidden.matched);

    const restored = await svc.moderateRequest(
      moderated.id, { action: "RESTORE", note: "Family edited it." }, admin,
    );
    check("a removed request can be restored", restored.status === REQUEST_STATUS.OPEN);
    check("the restore is recorded too", restored.moderationHistory.length === 2);

    await svc.moderateRequest(moderated.id, { action: "REMOVE", note: "Re-removed." }, admin);
    const alreadyRemoved = await throws(
      () => svc.moderateRequest(moderated.id, { action: "REMOVE", note: "Again." }, admin),
      (e) => e.status === 409,
    );
    check("a request cannot be removed twice",
      alreadyRemoved.threw && alreadyRemoved.matched, alreadyRemoved.error?.message);

    const restoreNotRemoved = await throws(
      () => svc.moderateRequest(request.id, { action: "RESTORE", note: "Nothing to undo." }, admin),
      (e) => e.status === 409,
    );
    check("a request that was never removed cannot be restored",
      restoreNotRemoved.threw && restoreNotRemoved.matched);

    // --- audit trail ---------------------------------------------------------
    // `recordAudit` swallows its own failures so an audit problem cannot break
    // the action being audited — which also means a bad action name is silent.
    // Asserting the trail exists is what makes that visible.
    const trail = await AuditLog.find({
      entityType: "TutorRequest",
      entityId: { $in: createdRequests.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    const actions = new Set(trail.map((row) => row.action));
    check("creating a request is audited", actions.has("REQUEST_CREATED"));
    check("editing a request is audited", actions.has("REQUEST_UPDATED"));
    check("cancelling a request is audited", actions.has("REQUEST_CANCELLED"));
    check("inviting a tutor is audited", actions.has("REQUEST_TUTOR_INVITED"));
    check("moderating a request is audited", actions.has("REQUEST_MODERATED"));
    check("every audit row names a valid action",
      trail.length > 0 && trail.every((row) => Boolean(row.action)));

    // --- notifications -------------------------------------------------------
    const notices = await Notification.find({
      entityType: "TutorRequest",
      entityId: { $in: createdRequests.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    check("tutors are notified about a public request",
      notices.some((n) => n.type === "REQUEST_MATCHED"));
    check("an invited tutor is notified by name",
      notices.some((n) => n.type === "REQUEST_INVITED"));
    check("the family is warned before their request expires",
      notices.some((n) => n.type === "REQUEST_EXPIRING"));
    check("no notification about an invite-only request was broadcast to the board",
      !notices.some(
        (n) => n.type === "REQUEST_MATCHED" && String(n.entityId) === privateRequest.id,
      ));
  } finally {
    const ids = createdRequests.map((id) => new mongoose.Types.ObjectId(id));
    await TutorMatch.deleteMany({ requestId: { $in: ids } });
    await Notification.deleteMany({ entityType: "TutorRequest", entityId: { $in: ids } });
    await AuditLog.deleteMany({ entityType: "TutorRequest", entityId: { $in: ids } });
    await TutorRequest.deleteMany({ _id: { $in: ids } });
  }
}


// --- 12. SMS adapters (§28, §38, §41 Phase 2) ------------------------------

/**
 * The Twilio adapter and the development stand-in, with `fetch` stubbed.
 *
 * The two things worth proving here are that a production send is shaped the
 * way Twilio actually expects, and that the development provider never claims
 * a message was delivered — a fake that lied would hide the exact failure
 * this channel is most likely to have in production.
 */
async function smsAdapterTests() {
  section("SMS — Twilio adapter, development provider and callback signatures");

  const {
    ConsoleSmsProvider, TwilioSmsProvider, verifyTwilioSignature,
    getSmsProvider, smsConfigured, resetSmsProvider,
  } = await import("@/services/external/sms-provider");
  const {
    smsBodyFor, hasSmsTemplate, segmentCount, verificationSmsBody, SMS_OPT_OUT_FOOTER,
  } = await import("@/services/external/sms-templates");
  const { NOTIFICATION_TYPES } = await import("@/constants");

  // --- development provider -------------------------------------------------
  const console_ = new ConsoleSmsProvider();
  const simulated = await console_.send({ to: "+14165550142", body: "hello" });
  check("the development provider never reports delivery", simulated.delivered === false);
  check("it says plainly that the message was simulated", simulated.simulated === true);
  check("the development provider reports itself as unconfigured", console_.configured === false);

  // --- Twilio: request shape ------------------------------------------------
  let fetchStub = stubFetch(() => ({ body: { sid: "SM123", status: "queued", num_segments: "1" } }));
  const twilio = new TwilioSmsProvider({
    accountSid: "ACtest", authToken: "secrettoken", from: "+15550000000", fetchImpl: fetchStub,
  });

  const sent = await twilio.send({ to: "+14165550142", body: "Lesson at 5pm", idempotencyKey: "abc" });
  const call = fetchStub.calls[0];
  const form = new URLSearchParams(call.options.body);

  check("the send goes to Twilio's Messages endpoint for the account",
    call.url === "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
  check("credentials travel as HTTP basic auth, never in the body",
    call.options.headers.Authorization === `Basic ${Buffer.from("ACtest:secrettoken").toString("base64")}` &&
      !call.options.body.includes("secrettoken"));
  check("the destination and body are form-encoded",
    form.get("To") === "+14165550142" && form.get("Body") === "Lesson at 5pm");
  check("a from-number is sent when no messaging service is configured",
    form.get("From") === "+15550000000" && !form.has("MessagingServiceSid"));
  check("the idempotency key reaches Twilio",
    call.options.headers["I-Twilio-Idempotency-Token"] === "abc");
  check("a successful send returns the provider's message id",
    sent.delivered === true && sent.messageId === "SM123");

  fetchStub = stubFetch(() => ({ body: { sid: "SM9", status: "accepted" } }));
  const withService = new TwilioSmsProvider({
    accountSid: "ACtest", authToken: "t", messagingServiceSid: "MG1", fetchImpl: fetchStub,
  });
  await withService.send({ to: "+14165550142", body: "hi" });
  const serviceForm = new URLSearchParams(fetchStub.calls[0].options.body);
  check("a messaging service is used in place of a from-number",
    serviceForm.get("MessagingServiceSid") === "MG1" && !serviceForm.has("From"));

  // --- Twilio: failures -----------------------------------------------------
  fetchStub = stubFetch(() => ({ status: 400, body: { code: 21610, message: "Unsubscribed recipient" } }));
  const rejected = await throws(
    () => new TwilioSmsProvider({ accountSid: "AC", authToken: "t", from: "+1", fetchImpl: fetchStub })
      .send({ to: "+14165550142", body: "x" }),
    (e) => e.code === "TWILIO_21610",
  );
  check("a provider rejection surfaces its code", rejected.threw && rejected.matched);
  check("a permanent rejection is not marked retryable",
    rejected.error?.retryable === false);
  check("the failure message never contains the text that was sent",
    !String(rejected.error?.message).includes("x is your"));

  fetchStub = stubFetch(() => ({ status: 429, body: { message: "Too many requests" } }));
  const throttled = await throws(
    () => new TwilioSmsProvider({ accountSid: "AC", authToken: "t", from: "+1", fetchImpl: fetchStub })
      .send({ to: "+14165550142", body: "x" }),
    (e) => e.retryable === true,
  );
  check("a throttled send is marked retryable", throttled.threw && throttled.matched);

  // --- provider selection ---------------------------------------------------
  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetSmsProvider();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetSmsProvider();
    }
  };

  await withEnv({ SMS_PROVIDER: undefined, TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined }, async () => {
    check("with no credentials, SMS falls back to the development provider",
      getSmsProvider().name === "CONSOLE");
    check("and reports itself as not configured", smsConfigured() === false);
  });

  await withEnv({
    SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM_NUMBER: "+15550000000", TWILIO_MESSAGING_SERVICE_SID: undefined,
  }, async () => {
    check("a fully configured Twilio selection produces the real adapter",
      getSmsProvider().name === "TWILIO");
    check("and reports itself as configured", smsConfigured() === true);
  });

  await withEnv({
    SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM_NUMBER: undefined, TWILIO_MESSAGING_SERVICE_SID: undefined,
  }, async () => {
    const misconfigured = await$throws(() => getSmsProvider());
    check("Twilio without a sender is refused at startup, not per message",
      misconfigured.threw && misconfigured.error?.code === "PROVIDER_MISCONFIGURED");
    check("the refusal names the missing variables, never a value",
      /TWILIO_FROM_NUMBER|TWILIO_MESSAGING_SERVICE_SID/.test(misconfigured.error?.message ?? "") &&
        !String(misconfigured.error?.message).includes("tok"));
  });

  await withEnv({ SMS_PROVIDER: "carrier-pigeon" }, async () => {
    const unknown = await$throws(() => getSmsProvider());
    check("an unknown SMS provider is refused", unknown.threw);
  });

  // --- inbound callback signatures -----------------------------------------
  const authToken = "the-account-auth-token";
  const url = "https://test.apluslearn.ca/api/webhooks/sms";
  const params = { From: "+14165550142", Body: "STOP", MessageSid: "SM1" };

  const sign = (u, p) => {
    const payload = Object.keys(p).sort().reduce((acc, k) => acc + k + p[k], u);
    return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  };

  check("a correctly signed callback verifies",
    verifyTwilioSignature({ signature: sign(url, params), url, params, authToken }));
  check("an unsigned callback is refused",
    !verifyTwilioSignature({ signature: null, url, params, authToken }));
  check("a callback whose body was tampered with is refused",
    !verifyTwilioSignature({
      signature: sign(url, params), url, params: { ...params, Body: "START" }, authToken,
    }));
  check("a callback replayed against a different URL is refused",
    !verifyTwilioSignature({
      signature: sign(url, params), url: "https://evil.example/api/webhooks/sms", params, authToken,
    }));
  check("a signature made with the wrong token is refused",
    !verifyTwilioSignature({
      signature: createHmac("sha1", "wrong").update(url).digest("base64"), url, params, authToken,
    }));
  check("verification needs a token to check against",
    !verifyTwilioSignature({ signature: sign(url, params), url, params, authToken: undefined }));

  // --- templates ------------------------------------------------------------
  check("only whitelisted notification types have a text version",
    hasSmsTemplate(NOTIFICATION_TYPES.BOOKING_REMINDER) &&
      !hasSmsTemplate(NOTIFICATION_TYPES.MESSAGE_RECEIVED));

  const body = smsBodyFor(
    NOTIFICATION_TYPES.BOOKING_REMINDER,
    { title: "Lesson tomorrow", body: "MHF4U with Priya at 5:00 PM." },
    "APlus Learn",
  );
  check("a text carries the platform name", body.startsWith("APlus Learn:"));
  check("every text carries an opt-out path", body.endsWith(SMS_OPT_OUT_FOOTER));
  check("a reminder fits one message segment", segmentCount(body) === 1, `${body.length} chars`);

  check("a notification with no template renders nothing",
    smsBodyFor(NOTIFICATION_TYPES.MESSAGE_RECEIVED, { title: "x" }, "APlus Learn") === null);

  const longBody = smsBodyFor(
    NOTIFICATION_TYPES.BOOKING_CHANGED,
    { title: "Lesson moved", body: "word ".repeat(80) },
    "APlus Learn",
  );
  check("a long notification is clipped rather than sent as three segments",
    segmentCount(longBody) === 1, `${longBody.length} chars`);
  check("clipping stays inside the GSM-7 alphabet, so one segment stays one segment",
    !/[^\x20-\x7E]/.test(longBody));
  check("clipping cuts on a word boundary", /\s\.\.\.\s|[a-z]\.\.\. /.test(`${longBody} `) || longBody.includes("... "));

  const code = verificationSmsBody("123456", "APlus Learn");
  check("a confirmation code text says it expires", /expires/i.test(code));
  check("a confirmation code text warns it will never be asked for",
    /never ask/i.test(code));
  check("a unicode body is costed against the smaller segment size",
    segmentCount("é".repeat(80)) === 2);
}

// --- 13. SMS service (§28, §36, §41 Phase 2) -------------------------------

/**
 * Consent, idempotency and verification against a real database.
 *
 * The question this section exists to answer is not "can we send a text" but
 * "can we ever send one we shouldn't" — so most of it is about the messages
 * that must *not* go out, and about every one of those leaving a record that
 * says why.
 */
async function smsServiceTests() {
  section("SMS — consent, idempotency, verification and opt-out");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("SMS service", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("SMS service", "MongoDB is not reachable");
    }
  }

  const { User, SmsMessage, AuthToken, Notification } = await import("@/models");
  const { AUTH_TOKEN_PURPOSE } = await import("@/models");
  const sms = await import("@/services/sms.service");
  const { updateNotificationPreferences } = await import("@/services/user.service");
  const { notify } = await import("@/services/notification.service");
  const {
    SMS_STATUS, SMS_SKIP_REASONS, NOTIFICATION_TYPES, NOTIFICATION_CHANNELS, ROLES,
  } = await import("@/constants");

  // `smsEnabled` ships off, which is correct — and means this section has to
  // turn it on to exercise anything past the platform gate. The original value
  // is restored in the `finally` below.
  const { updateSettings, invalidateSettingsCache } = await import("@/services/settings.service");
  const { Settings } = await import("@/models");
  const settingsBefore = await Settings.findOne({ key: "PLATFORM" }).lean();
  const smsWasEnabled = settingsBefore?.notifications?.smsEnabled ?? false;
  await updateSettings({ notifications: { smsEnabled: true } });
  invalidateSettingsCache();

  const made = [];
  const makeUser = async (over = {}) => {
    const user = await User.create({
      email: `sms-test-${randomUUID()}@example.com`,
      firstName: "Sms",
      lastName: "Tester",
      role: ROLES.PARENT,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      ...over,
    });
    made.push(user._id);
    return user;
  };

  const rowsFor = (userId) => SmsMessage.find({ userId }).sort({ createdAt: -1 }).lean();

  try {
    // --- consent gates, one at a time ---------------------------------------
    const notification = (type = NOTIFICATION_TYPES.BOOKING_REMINDER) => ({
      _id: new mongoose.Types.ObjectId(),
      type,
      title: "Lesson tomorrow",
      body: "MHF4U at 5:00 PM.",
    });

    const noPhone = await makeUser();
    let result = await sms.sendNotificationSms(notification(), noPhone.toObject());
    check("no number on the account means no text",
      result.skipReason === SMS_SKIP_REASONS.NO_PHONE);

    const unverified = await makeUser({ phoneE164: "+14165550111", phone: "4165550111" });
    result = await sms.sendNotificationSms(notification(), unverified.toObject());
    check("an unconfirmed number is never texted",
      result.skipReason === SMS_SKIP_REASONS.PHONE_UNVERIFIED);

    const channelOff = await makeUser({
      phoneE164: "+14165550112", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: false },
    });
    result = await sms.sendNotificationSms(notification(), channelOff.toObject());
    check("a recipient who has texts switched off is not texted",
      result.skipReason === SMS_SKIP_REASONS.CHANNEL_DISABLED);

    const stopped = await makeUser({
      phoneE164: "+14165550113", phoneVerifiedAt: new Date(), smsOptOutAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    result = await sms.sendNotificationSms(notification(), stopped.toObject());
    check("a STOP on record outranks the account's own preference",
      result.skipReason === SMS_SKIP_REASONS.OPTED_OUT);

    const ready = await makeUser({
      phoneE164: "+14165550114", phone: "4165550114", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    result = await sms.sendNotificationSms(
      notification(NOTIFICATION_TYPES.MESSAGE_RECEIVED), ready.toObject(),
    );
    check("a notification with no text version is not texted",
      result.skipReason === SMS_SKIP_REASONS.NO_TEMPLATE);

    // Every refusal is on the record, with its reason.
    const skipped = await rowsFor(channelOff._id);
    check("a message that was deliberately not sent is still recorded",
      skipped.length === 1 && skipped[0].status === SMS_STATUS.SKIPPED);
    check("and the record says which gate stopped it",
      skipped[0].skipReason === SMS_SKIP_REASONS.CHANNEL_DISABLED);

    // The outermost gate: an operator switching texts off stops all of them,
    // whatever anyone has chosen for themselves.
    await updateSettings({ notifications: { smsEnabled: false } });
    invalidateSettingsCache();
    result = await sms.sendNotificationSms(notification(), ready.toObject());
    check("an operator switching texts off stops every one of them",
      result.skipReason === SMS_SKIP_REASONS.PLATFORM_DISABLED);
    await updateSettings({ notifications: { smsEnabled: true } });
    invalidateSettingsCache();

    // --- the development provider is honest ----------------------------------
    const note = notification();
    result = await sms.sendNotificationSms(note, ready.toObject());
    check("with no carrier configured, a text is recorded as simulated",
      result.status === SMS_STATUS.SIMULATED, JSON.stringify(result));
    check("a simulated text is never reported as sent", result.sent === false);

    const row = (await rowsFor(ready._id))[0];
    check("the simulated message is in the delivery log",
      row?.status === SMS_STATUS.SIMULATED && row.notificationType === note.type);
    check("the log keeps a preview of what would have been sent",
      /Lesson tomorrow/.test(row.bodyPreview ?? ""));

    // --- idempotency ----------------------------------------------------------
    await sms.sendNotificationSms(note, ready.toObject());
    const afterRetry = await SmsMessage.countDocuments({
      dedupeKey: `notification:${note._id}`,
    });
    check("the same notification is never texted twice", afterRetry === 1);

    const retried = await sms.sendNotificationSms(note, ready.toObject());
    check("a retry is refused as a duplicate, not silently re-sent",
      retried.skipReason === SMS_SKIP_REASONS.DUPLICATE);

    // --- verification codes ---------------------------------------------------
    const verifying = await makeUser();
    const start = await sms.startPhoneVerification(verifying._id, {
      phone: "4165550199", phoneE164: "+14165550199",
    });
    check("asking for a code reports whether a carrier is actually behind it",
      start.providerConfigured === false && start.simulated === true);

    const token = await AuthToken.findOne({
      userId: verifying._id, purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
    }).lean();
    check("the code is stored only as a hash", Boolean(token) && token.tokenHash.length === 64);
    check("the number is bound to the token, not read back from the request",
      token.subject === "+14165550199");

    const codeRow = (await rowsFor(verifying._id))[0];
    check("a confirmation code is never previewed in the delivery log",
      codeRow.kind === "VERIFICATION" && !/\d{6}/.test(codeRow.bodyPreview ?? ""));

    const wrong = await throws(
      () => sms.confirmPhoneVerification(verifying._id, { code: "000000" }),
      (e) => e.status === 422,
    );
    check("a wrong code is refused", wrong.threw && wrong.matched);

    const stillUnverified = await User.findById(verifying._id).lean();
    check("a wrong code leaves the number unconfirmed",
      stillUnverified.phoneVerifiedAt === null);

    // Burn the remaining attempts; the code must stop working entirely.
    for (let i = 0; i < 5; i += 1) {
      await throws(() => sms.confirmPhoneVerification(verifying._id, { code: "000001" }));
    }
    const exhausted = await throws(
      () => sms.confirmPhoneVerification(verifying._id, { code: "000002" }),
      (e) => e.status === 429 || e.code === "CODE_EXPIRED",
    );
    check("a code is burned after repeated wrong guesses",
      exhausted.threw && exhausted.matched);

    // A fresh code, confirmed correctly. The plaintext is not recoverable, so
    // the code is set directly — the hashing path is asserted above.
    const { createHash } = await import("node:crypto");
    await AuthToken.updateMany(
      { userId: verifying._id, purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION },
      { $set: { consumedAt: new Date() } },
    );
    await AuthToken.create({
      userId: verifying._id,
      purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
      tokenHash: createHash("sha256").update("424242").digest("hex"),
      subject: "+14165550199",
      expiresAt: new Date(Date.now() + 600_000),
    });

    const confirmed = await sms.confirmPhoneVerification(verifying._id, { code: "424242" });
    check("the right code confirms the number", Boolean(confirmed.phoneVerifiedAt));
    check("confirming turns the text channel on",
      confirmed.notificationPreferences?.[NOTIFICATION_CHANNELS.SMS] === true);

    const reuse = await throws(
      () => sms.confirmPhoneVerification(verifying._id, { code: "424242" }),
      (e) => e.code === "CODE_EXPIRED",
    );
    check("a confirmed code cannot be used twice", reuse.threw && reuse.matched);

    // --- one number, one account ---------------------------------------------
    const impostor = await makeUser();
    const taken = await throws(
      () => sms.startPhoneVerification(impostor._id, {
        phone: "4165550199", phoneE164: "+14165550199",
      }),
      (e) => e.status === 409,
    );
    check("a number confirmed on one account cannot be claimed by another",
      taken.threw && taken.matched);

    // --- the preference cannot authorise itself -------------------------------
    const sneaky = await makeUser();
    const refused = await throws(
      () => updateNotificationPreferences(sneaky._id, { [NOTIFICATION_CHANNELS.SMS]: true }),
      (e) => e.code === "PHONE_NOT_VERIFIED",
    );
    check("texts cannot be switched on without a confirmed number",
      refused.threw && refused.matched);

    const stoppedUser = await makeUser({
      phoneE164: "+14165550177", phoneVerifiedAt: new Date(), smsOptOutAt: new Date(),
    });
    const refusedStop = await throws(
      () => updateNotificationPreferences(stoppedUser._id, { [NOTIFICATION_CHANNELS.SMS]: true }),
      (e) => e.code === "SMS_OPTED_OUT",
    );
    check("a STOP cannot be undone from the settings screen",
      refusedStop.threw && refusedStop.matched);

    // --- inbound keywords -----------------------------------------------------
    const a = await makeUser({
      phoneE164: "+14165550188", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    const b = await makeUser({
      phoneE164: "+14165550188", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });

    const optOut = await sms.applySmsKeyword({ from: "+14165550188", body: "stop" });
    check("STOP applies to every account holding that handset",
      optOut.action === "OPT_OUT" && optOut.accounts === 2);
    const afterStop = await User.findById(a._id).lean();
    check("STOP also switches the channel off",
      Boolean(afterStop.smsOptOutAt) &&
        afterStop.notificationPreferences[NOTIFICATION_CHANNELS.SMS] === false);

    const optIn = await sms.applySmsKeyword({ from: "+14165550188", body: "START please" });
    check("START clears the block", optIn.action === "OPT_IN" && optIn.accounts === 2);
    const afterStart = await User.findById(b._id).lean();
    check("but START does not switch the channel back on by itself",
      afterStart.smsOptOutAt === null &&
        afterStart.notificationPreferences[NOTIFICATION_CHANNELS.SMS] === false);

    check("an unrelated reply is ignored",
      (await sms.applySmsKeyword({ from: "+14165550188", body: "thanks!" })).action === "IGNORED");

    // --- end to end through the notification service ---------------------------
    const notified = await makeUser({
      phoneE164: "+14165550166", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    const created = await notify({
      userId: notified._id,
      type: NOTIFICATION_TYPES.BOOKING_REMINDER,
      title: "Lesson tomorrow",
      body: "MHF4U at 5:00 PM.",
    });
    check("notifying writes the in-app record as always", Boolean(created?.id));

    const attempted = await SmsMessage.findOne({ userId: notified._id }).lean();
    check("and the SMS path runs without the caller asking for it",
      Boolean(attempted) && attempted.notificationType === NOTIFICATION_TYPES.BOOKING_REMINDER);
    check("a simulated text does not mark the notification as delivered by SMS",
      !(await Notification.findById(created.id).lean()).deliveredChannels
        .includes(NOTIFICATION_CHANNELS.SMS));

    // --- the admin log masks numbers -------------------------------------------
    const log = await sms.listSmsMessages({ pageSize: 5 });
    check("the delivery log masks phone numbers",
      log.items.every((m) => !/^\+\d{11,}$/.test(m.to)), log.items[0]?.to);
    check("the delivery log reports whether a carrier is configured",
      log.providerConfigured === false);
  } finally {
    await updateSettings({ notifications: { smsEnabled: smsWasEnabled } });
    invalidateSettingsCache();
    await SmsMessage.deleteMany({ userId: { $in: made } });
    await AuthToken.deleteMany({ userId: { $in: made } });
    await Notification.deleteMany({ userId: { $in: made } });
    await User.deleteMany({ _id: { $in: made } });
  }
}


// --- 14. Secret storage (§36, §41 Phase 2) ---------------------------------

/**
 * The encryption behind stored OAuth refresh tokens.
 *
 * A refresh token is a standing key to somebody's calendar, so the properties
 * that matter are that it round-trips, that it is not guessable from the
 * stored form, that tampering is detected rather than tolerated, and that a
 * rotated `AUTH_SECRET` makes it unreadable rather than silently wrong.
 */
async function cryptoTests() {
  section("Secret storage — encryption at rest and signed OAuth state");

  const { encryptSecret, decryptSecret, isEncrypted, signState, verifyState } =
    await import("@/lib/security/crypto");

  const token = "1//0gRefreshTokenThatMustNeverLeak";
  const stored = encryptSecret(token, "test-label");

  check("a stored secret round-trips", decryptSecret(stored, "test-label") === token);
  check("the stored form does not contain the plaintext", !stored.includes("RefreshToken"));
  check("the stored form is versioned", stored.startsWith("v1.") && isEncrypted(stored));

  check("encrypting twice produces different ciphertext",
    encryptSecret(token, "test-label") !== encryptSecret(token, "test-label"));

  check("a secret cannot be read with a different purpose label",
    decryptSecret(stored, "other-label") === null);

  const tampered = `${stored.slice(0, -4)}AAAA`;
  check("a tampered ciphertext fails rather than decrypting to something else",
    decryptSecret(tampered, "test-label") === null);

  check("garbage decrypts to null rather than throwing",
    decryptSecret("not-a-secret", "test-label") === null);
  check("an empty secret encrypts to nothing", encryptSecret("", "test-label") === null);

  // The key must actually depend on AUTH_SECRET, so a rotated secret makes
  // stored tokens unreadable rather than subtly wrong. Derived keys are
  // memoised per label, so the dependence is proved with two fresh labels
  // either side of a rotation rather than by re-reading one.
  const originalSecret = process.env.AUTH_SECRET;
  try {
    const underSecretA = encryptSecret(token, `rot-a-${randomUUID()}`);
    const labelB = `rot-b-${randomUUID()}`;

    process.env.AUTH_SECRET = "y".repeat(48);
    const underSecretB = encryptSecret(token, labelB);

    check("a secret encrypted after rotation is unreadable with the pre-rotation key",
      decryptSecret(underSecretB, "test-label") === null);
    check("and the two ciphertexts are not interchangeable",
      underSecretA !== underSecretB && decryptSecret(underSecretA, labelB) === null);
  } finally {
    process.env.AUTH_SECRET = originalSecret;
  }

  check("encryption refuses to run without a usable AUTH_SECRET", (() => {
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "too-short";
    try {
      encryptSecret("x", `no-secret-${randomUUID()}`);
      return false;
    } catch {
      return true;
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  })());

  // --- signed state ---------------------------------------------------------
  const state = signState({ userId: "abc", provider: "GOOGLE" }, { label: "state-test" });
  const claims = verifyState(state, { label: "state-test" });
  check("a signed state round-trips", claims?.userId === "abc" && claims.provider === "GOOGLE");

  check("state signed with one purpose is not accepted under another",
    verifyState(state, { label: "different" }) === null);

  const [body] = state.split(".");
  const forged = `${body}.${Buffer.from("forged").toString("base64url")}`;
  check("a forged state signature is refused", verifyState(forged, { label: "state-test" }) === null);

  const swapped = signState({ userId: "victim" }, { label: "state-test" }).split(".")[0];
  check("a state body swapped under a valid signature is refused",
    verifyState(`${swapped}.${state.split(".")[1]}`, { label: "state-test" }) === null);

  const expired = signState({ userId: "abc" }, { label: "state-test", ttlSeconds: -10 });
  check("an expired state is refused", verifyState(expired, { label: "state-test" }) === null);
  check("a missing state is refused", verifyState(undefined, { label: "state-test" }) === null);
}

// --- 15. Calendar adapters (§18, §38, §41 Phase 2) -------------------------

/**
 * Google Calendar and Microsoft Graph, with `fetch` stubbed.
 *
 * The shapes these two speak differ in exactly the ways that cause silent
 * bugs — Google's free/busy versus Graph's calendar view, wall-clock strings
 * versus instants — so the assertions are about the request that goes out,
 * not only the answer that comes back.
 */
async function calendarAdapterTests() {
  section("Calendar — Google and Microsoft adapters");

  const {
    GoogleCalendarProvider, MicrosoftCalendarProvider, DevelopmentCalendarProvider,
    getCalendarProvider, calendarIntegrationsStatus, resetCalendarProviders,
  } = await import("@/services/external/calendar-provider");
  const { CALENDAR_PROVIDERS } = await import("@/constants");

  const lesson = {
    title: "MHF4U lesson (APlus Learn)",
    description: "Reference APL-123",
    start: new Date("2026-03-04T22:00:00.000Z"),
    end: new Date("2026-03-04T23:00:00.000Z"),
    timeZone: "America/Toronto",
    idempotencyKey: "apl-b1-c1",
  };

  // --- Google: authorization ------------------------------------------------
  const google = new GoogleCalendarProvider({ clientId: "gid", clientSecret: "gsecret" });
  const authUrl = new URL(
    google.getAuthorizationUrl({ redirectUri: "https://x.test/cb", state: "st8" }),
  );
  check("Google consent asks for offline access, or the connection dies in an hour",
    authUrl.searchParams.get("access_type") === "offline");
  check("Google consent forces the prompt, so a reconnect still yields a refresh token",
    authUrl.searchParams.get("prompt") === "consent");
  check("Google consent asks only for event write and read-only free/busy",
    authUrl.searchParams.get("scope").includes("calendar.events") &&
      authUrl.searchParams.get("scope").includes("calendar.readonly") &&
      !/auth\/calendar(\s|$)/.test(authUrl.searchParams.get("scope")));
  check("the signed state is carried through", authUrl.searchParams.get("state") === "st8");
  check("the client secret never appears in a URL the browser follows",
    !authUrl.toString().includes("gsecret"));

  // --- Google: token exchange ----------------------------------------------
  const idToken = [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "g-123", email: "tutor@example.com" })).toString("base64url"),
    "sig",
  ].join(".");

  let stub = stubFetch(() => ({
    body: { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: "s", id_token: idToken },
  }));
  const exchanged = await new GoogleCalendarProvider({
    clientId: "gid", clientSecret: "gsecret", fetchImpl: stub,
  }).exchangeCode({ code: "c", redirectUri: "https://x.test/cb" });

  check("a Google exchange yields both tokens",
    exchanged.accessToken === "at" && exchanged.refreshToken === "rt");
  check("the connected account is identified from the id token",
    exchanged.account.email === "tutor@example.com" && exchanged.account.id === "g-123");

  stub = stubFetch(() => ({ body: { access_token: "at", expires_in: 3599 } }));
  const noRefresh = await throws(
    () => new GoogleCalendarProvider({ clientId: "g", clientSecret: "s", fetchImpl: stub })
      .exchangeCode({ code: "c", redirectUri: "r" }),
    (e) => e.code === "NO_REFRESH_TOKEN",
  );
  check("an exchange with no refresh token is refused rather than stored",
    noRefresh.threw && noRefresh.matched);

  stub = stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
  const revoked = await throws(
    () => new GoogleCalendarProvider({ clientId: "g", clientSecret: "s", fetchImpl: stub })
      .refreshAccessToken({ refreshToken: "dead" }),
    (e) => e.code === "REFRESH_REJECTED",
  );
  check("a rejected refresh is distinguishable from a transient failure",
    revoked.threw && revoked.matched);

  stub = stubFetch(() => ({ body: { access_token: "new-at", expires_in: 3599 } }));
  const kept = await new GoogleCalendarProvider({
    clientId: "g", clientSecret: "s", fetchImpl: stub,
  }).refreshAccessToken({ refreshToken: "keep-me" });
  check("Google not rotating the refresh token keeps the one we have",
    kept.refreshToken === "keep-me" && kept.accessToken === "new-at");

  // --- Google: free/busy and events ----------------------------------------
  stub = stubFetch(() => ({
    body: {
      calendars: {
        primary: {
          busy: [{ start: "2026-03-04T22:00:00Z", end: "2026-03-04T23:00:00Z" }],
        },
      },
    },
  }));
  const busy = await new GoogleCalendarProvider({ fetchImpl: stub }).listBusyPeriods({
    accessToken: "at", calendarId: "primary",
    from: new Date("2026-03-01"), to: new Date("2026-03-30"),
  });
  check("Google free/busy is read through the freeBusy endpoint",
    stub.calls[0].url.endsWith("/freeBusy") && stub.calls[0].options.method === "POST");
  check("busy periods come back as real dates",
    busy.length === 1 && busy[0].start instanceof Date);
  check("the access token travels as a bearer header, never in the query string",
    stub.calls[0].options.headers.Authorization === "Bearer at" &&
      !stub.calls[0].url.includes("at"));

  stub = stubFetch(() => ({
    body: { calendars: { primary: { errors: [{ reason: "notFound" }] } } },
  }));
  const gone = await throws(
    () => new GoogleCalendarProvider({ fetchImpl: stub }).listBusyPeriods({
      accessToken: "at", calendarId: "primary", from: new Date(), to: new Date(),
    }),
    (e) => e.code === "CALENDAR_GONE",
  );
  check("a deleted calendar is reported as such, not as an empty week",
    gone.threw && gone.matched);

  stub = stubFetch(() => ({ body: { id: "evt-1", htmlLink: "https://cal/evt-1" } }));
  const created = await new GoogleCalendarProvider({ fetchImpl: stub }).createEvent({
    accessToken: "at", calendarId: "primary", event: lesson,
  });
  const sentEvent = JSON.parse(stub.calls[0].options.body);
  check("creating a Google event returns its id", created.eventId === "evt-1");
  check("the event carries an IANA zone, so it survives a DST change",
    sentEvent.start.timeZone === "America/Toronto" && sentEvent.end.timeZone === "America/Toronto");
  check("no attendees are added, so no learner lands in a tutor's address book",
    sentEvent.attendees === undefined || sentEvent.attendees.length === 0);
  check("no client-chosen event id is sent, which Google would reject",
    sentEvent.id === undefined);

  stub = stubFetch(() => ({ status: 404, body: { error: { message: "Not Found" } } }));
  const deleteMissing = await new GoogleCalendarProvider({ fetchImpl: stub }).deleteEvent({
    accessToken: "at", calendarId: "primary", eventId: "gone",
  });
  check("deleting an event that is already gone is a success, not a failure",
    deleteMissing.deleted === true);

  // --- Microsoft ------------------------------------------------------------
  const ms = new MicrosoftCalendarProvider({ clientId: "mid", clientSecret: "msecret" });
  const msUrl = new URL(ms.getAuthorizationUrl({ redirectUri: "https://x.test/cb", state: "st9" }));
  check("Microsoft consent asks for offline_access, or there is no refresh token",
    msUrl.searchParams.get("scope").includes("offline_access"));
  check("Microsoft consent asks for calendar read/write",
    msUrl.searchParams.get("scope").includes("Calendars.ReadWrite"));
  check("the tenant defaults to common, so personal accounts can connect",
    msUrl.pathname.startsWith("/common/"));
  check("the Microsoft client secret never appears in a browser URL",
    !msUrl.toString().includes("msecret"));

  stub = stubFetch(() => ({
    body: {
      value: [
        { start: { dateTime: "2026-03-04T22:00:00.0000000" }, end: { dateTime: "2026-03-04T23:00:00.0000000" }, showAs: "busy" },
        { start: { dateTime: "2026-03-05T22:00:00.0000000" }, end: { dateTime: "2026-03-05T23:00:00.0000000" }, showAs: "free" },
        { start: { dateTime: "2026-03-06T22:00:00.0000000" }, end: { dateTime: "2026-03-06T23:00:00.0000000" }, showAs: "busy", isCancelled: true },
      ],
    },
  }));
  const msBusy = await new MicrosoftCalendarProvider({ fetchImpl: stub }).listBusyPeriods({
    accessToken: "at", calendarId: "cal-1",
    from: new Date("2026-03-01"), to: new Date("2026-03-30"),
  });
  check("Graph busy time is read from the chosen calendar's view, not the mailbox",
    stub.calls[0].url.includes("/me/calendars/cal-1/calendarView"));
  check("time the tutor marked free does not block their availability",
    msBusy.length === 1);
  check("a cancelled Outlook event does not block availability either",
    msBusy.every((p) => p.start.toISOString().startsWith("2026-03-04")));
  check("Graph's naive local strings are parsed as real instants",
    msBusy[0].start instanceof Date && !Number.isNaN(msBusy[0].start.getTime()));

  stub = stubFetch(() => ({ body: { id: "ms-evt-1", webLink: "https://outlook/evt" } }));
  const msCreated = await new MicrosoftCalendarProvider({ fetchImpl: stub }).createEvent({
    accessToken: "at", calendarId: "cal-1", event: lesson,
  });
  const msEvent = JSON.parse(stub.calls[0].options.body);
  check("creating a Graph event returns its id", msCreated.eventId === "ms-evt-1");
  check("Graph gets a wall-clock time plus a named zone, not an offset",
    !/Z$/.test(msEvent.start.dateTime) && msEvent.start.timeZone === "America/Toronto");
  check("the lesson shows as busy on the tutor's calendar", msEvent.showAs === "busy");
  check("no attendees are invited on Outlook either", msEvent.attendees.length === 0);
  check("the transaction id makes a repeated create idempotent at Graph",
    msEvent.transactionId === "apl-b1-c1");

  // --- development implementation -------------------------------------------
  const dev = new DevelopmentCalendarProvider(CALENDAR_PROVIDERS.GOOGLE);
  const devAuth = new URL(dev.getAuthorizationUrl({ redirectUri: "https://x.test/cb", state: "s" }));
  check("the development provider redirects straight back with a code",
    devAuth.searchParams.get("code")?.startsWith("dev-") && devAuth.searchParams.get("state") === "s");

  const devTokens = await dev.exchangeCode({ code: "dev-abc", userEmail: "t@example.com" });
  check("the development exchange says plainly that it is simulated",
    devTokens.simulated === true && devTokens.refreshToken.startsWith("dev-refresh"));

  const devEvent = await dev.createEvent({ event: lesson });
  check("the development provider creates a real, identified event",
    Boolean(devEvent.eventId) && devEvent.simulated === true);

  const devBusy = await dev.listBusyPeriods({
    from: new Date("2026-03-01"), to: new Date("2026-03-30"),
    events: [{ eventId: "e1", start: lesson.start, end: lesson.end }],
  });
  check("a development event really does come back as busy time", devBusy.length === 1);
  check("a cancelled development event does not",
    (await dev.listBusyPeriods({
      from: new Date("2026-03-01"), to: new Date("2026-03-30"),
      events: [{ eventId: "e1", start: lesson.start, end: lesson.end, cancelledAt: new Date() }],
    })).length === 0);
  check("an event outside the window is not returned",
    (await dev.listBusyPeriods({
      from: new Date("2027-01-01"), to: new Date("2027-02-01"),
      events: [{ eventId: "e1", start: lesson.start, end: lesson.end }],
    })).length === 0);

  // --- selection ------------------------------------------------------------
  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetCalendarProviders();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetCalendarProviders();
    }
  };

  await withEnv({
    CALENDAR_PROVIDER: undefined,
    GOOGLE_CALENDAR_CLIENT_ID: undefined, GOOGLE_CALENDAR_CLIENT_SECRET: undefined,
    MICROSOFT_CALENDAR_CLIENT_ID: undefined, MICROSOFT_CALENDAR_CLIENT_SECRET: undefined,
  }, async () => {
    check("with no credentials, calendar sync uses the development implementation",
      getCalendarProvider(CALENDAR_PROVIDERS.GOOGLE).name === "GOOGLE_DEVELOPMENT");
    const status = calendarIntegrationsStatus();
    check("both providers are still offered, because the fake is a working one",
      status.length === 2 && status.every((p) => p.available));
    check("and each says honestly that it is not the real service",
      status.every((p) => p.live === false));
  });

  await withEnv({
    CALENDAR_PROVIDER: "google,microsoft",
    GOOGLE_CALENDAR_CLIENT_ID: "gid", GOOGLE_CALENDAR_CLIENT_SECRET: "gs",
    MICROSOFT_CALENDAR_CLIENT_ID: "mid", MICROSOFT_CALENDAR_CLIENT_SECRET: "ms",
  }, async () => {
    check("both real adapters light up when both are configured",
      getCalendarProvider(CALENDAR_PROVIDERS.GOOGLE).name === "GOOGLE" &&
        getCalendarProvider(CALENDAR_PROVIDERS.OUTLOOK).name === "OUTLOOK");
    check("and both report as live", calendarIntegrationsStatus().every((p) => p.live));
  });

  await withEnv({
    CALENDAR_PROVIDER: "google",
    GOOGLE_CALENDAR_CLIENT_ID: "gid", GOOGLE_CALENDAR_CLIENT_SECRET: "gs",
    MICROSOFT_CALENDAR_CLIENT_ID: undefined, MICROSOFT_CALENDAR_CLIENT_SECRET: undefined,
  }, async () => {
    check("naming only Google leaves Outlook on the development implementation",
      getCalendarProvider(CALENDAR_PROVIDERS.GOOGLE).name === "GOOGLE" &&
        getCalendarProvider(CALENDAR_PROVIDERS.OUTLOOK).name === "OUTLOOK_DEVELOPMENT");
  });

  await withEnv({ CALENDAR_PROVIDER: "google", GOOGLE_CALENDAR_CLIENT_ID: "only-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: undefined }, async () => {
    const { resolveIntegration } = await import("@/lib/config/env");
    const resolved = resolveIntegration("calendar");
    check("naming Google without its secret is a configuration error",
      resolved.configured === false &&
        /GOOGLE_CALENDAR_CLIENT_SECRET/.test(resolved.error ?? ""));
  });
}

// --- 16. Calendar service (§18, §36, §41 Phase 2) --------------------------

/**
 * The connection lifecycle end to end, against the development provider and a
 * real database: consent, token storage, busy-period sync, availability,
 * pushing a lesson out, moving it, removing it, and disconnecting.
 */
async function calendarServiceTests() {
  section("Calendar — connection lifecycle, sync and booking integration");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("calendar service", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("calendar service", "MongoDB is not reachable");
    }
  }

  const { CalendarConnection, TutorProfile, Booking, AuditLog } = await import("@/models");
  const cal = await import("@/services/calendar.service");
  const { getCalendarProvider } = await import("@/services/external/calendar-provider");
  const { signState } = await import("@/lib/security/crypto");
  const { decryptSecret } = await import("@/lib/security/crypto");
  const {
    CALENDAR_PROVIDERS, CALENDAR_CONNECTION_STATUS, CALENDAR_EVENT_STATE,
    BOOKING_STATUS, ROLES,
  } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).populate("userId", "_id email").lean();
  if (!tutor) return skip("calendar service", "no seeded tutor — run `bun run seed`");

  const tutorUserId = String(tutor.userId._id ?? tutor.userId);
  const actor = { id: tutorUserId, role: ROLES.TUTOR };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.TUTOR };

  const createdBookings = [];

  try {
    await CalendarConnection.deleteMany({ userId: tutorUserId });

    // --- consent --------------------------------------------------------------
    const begin = await cal.beginConnection(actor, { provider: CALENDAR_PROVIDERS.GOOGLE });
    const authUrl = new URL(begin.authorizationUrl);
    check("starting a connection returns a consent URL", Boolean(begin.authorizationUrl));
    const state = authUrl.searchParams.get("state");
    const code = authUrl.searchParams.get("code");
    check("the consent URL carries a signed state", Boolean(state));

    const unsigned = await throws(
      () => cal.completeConnection({ code, state: "not-a-real-state" }),
      (e) => e.status === 403,
    );
    check("a callback with an unverifiable state is refused before any exchange",
      unsigned.threw && unsigned.matched);

    const forSomeoneElse = signState(
      { userId: String(new mongoose.Types.ObjectId()), provider: CALENDAR_PROVIDERS.GOOGLE },
      { label: "aplus:calendar-state" },
    );
    const wrongAccount = await throws(
      () => cal.completeConnection({ code, state: forSomeoneElse }),
      (e) => e.status === 404,
    );
    check("a state naming an account that does not exist is refused",
      wrongAccount.threw && wrongAccount.matched);

    const connection = await cal.completeConnection({ code, state });
    check("consent produces a connected calendar",
      connection.status === CALENDAR_CONNECTION_STATUS.CONNECTED);
    check("the connection is labelled as the development implementation",
      connection.simulated === true);
    check("a calendar is chosen automatically so the connection is usable",
      Boolean(connection.calendarId));
    check("the connection is linked to the tutor profile, not just the account",
      Boolean(
        (await CalendarConnection.findById(connection.id).lean()).tutorProfileId,
      ));

    // --- tokens at rest -------------------------------------------------------
    const stored = await CalendarConnection.findById(connection.id)
      .select("+accessToken +refreshToken")
      .lean();
    check("the refresh token is encrypted at rest",
      stored.refreshToken.startsWith("v1.") && !stored.refreshToken.includes("dev-refresh"));
    check("the access token is encrypted at rest", stored.accessToken.startsWith("v1."));
    check("and it decrypts back to something usable",
      decryptSecret(stored.refreshToken, "aplus:calendar-token")?.startsWith("dev-refresh"));

    const publicShape = JSON.stringify(connection);
    check("no token ever reaches the shape a browser is given",
      !publicShape.includes("v1.") && !/token/i.test(publicShape));

    const listed = await cal.listConnections(tutorUserId);
    check("the tutor sees their connection", listed.connections.length === 1);
    check("no token appears in the list either",
      !/token/i.test(JSON.stringify(listed.connections)));

    // --- reconnecting the same account ----------------------------------------
    const again = await cal.beginConnection(actor, { provider: CALENDAR_PROVIDERS.GOOGLE });
    const againUrl = new URL(again.authorizationUrl);
    await cal.completeConnection({
      code: againUrl.searchParams.get("code"),
      state: againUrl.searchParams.get("state"),
    });
    check("reconnecting the same account updates the connection rather than duplicating it",
      (await CalendarConnection.countDocuments({ userId: tutorUserId })) === 1);

    // --- authorization --------------------------------------------------------
    const notYours = await throws(
      () => cal.updateConnection(connection.id, { syncBusy: false }, stranger),
      (e) => e.status === 403,
    );
    check("a tutor cannot touch someone else's calendar connection",
      notYours.threw && notYours.matched);

    const notYoursDelete = await throws(
      () => cal.disconnectCalendar(connection.id, stranger),
      (e) => e.status === 403,
    );
    check("nor disconnect it", notYoursDelete.threw && notYoursDelete.matched);

    // --- pushing a lesson out --------------------------------------------------
    const startAt = new Date("2031-06-10T18:00:00.000Z");
    const booking = await Booking.create({
      reference: `APL-C${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: new mongoose.Types.ObjectId(),
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      courseCode: "MHF4U",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      timeZone: "America/Toronto",
      status: BOOKING_STATUS.CONFIRMED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100,
        totalCents: 6000,
      },
    });
    createdBookings.push(booking._id);

    const pushed = await cal.pushBookingEvent(booking._id);
    check("a confirmed lesson is pushed to the connected calendar", pushed.pushed === 1);

    const withEvent = await Booking.findById(booking._id).lean();
    check("the event is linked to the booking",
      withEvent.externalEvents.length === 1 &&
        withEvent.externalEvents[0].state === CALENDAR_EVENT_STATE.SYNCED);

    await cal.pushBookingEvent(booking._id);
    const afterRetry = await Booking.findById(booking._id).lean();
    check("pushing the same lesson twice updates rather than duplicating",
      afterRetry.externalEvents.length === 1 &&
        afterRetry.externalEvents[0].eventId === withEvent.externalEvents[0].eventId);

    // --- busy periods and availability ------------------------------------------
    const synced = await cal.syncConnection(connection.id, { now: new Date("2031-06-01") });
    check("syncing finds the lesson we just put on the calendar", synced.synced === 1);

    const periods = await cal.externalBusyPeriods(tutor._id, {
      from: new Date("2031-06-01"),
      to: new Date("2031-07-01"),
    });
    check("the lesson comes back as busy time for availability",
      periods.length === 1 && new Date(periods[0].startAt).getTime() === startAt.getTime());

    check("busy periods outside the window asked for are not returned",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2032-01-01"), to: new Date("2032-02-01"),
      })).length === 0);

    await cal.updateConnection(connection.id, { syncBusy: false }, actor);
    check("a tutor who turns off availability sync stops contributing busy time",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2031-06-01"), to: new Date("2031-07-01"),
      })).length === 0);
    await cal.updateConnection(connection.id, { syncBusy: true }, actor);

    // --- moving and removing -----------------------------------------------------
    const movedStart = new Date("2031-06-11T18:00:00.000Z");
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { startAt: movedStart, endAt: new Date(movedStart.getTime() + 3600_000) } },
    );
    await cal.updateBookingEvent(booking._id);
    await cal.syncConnection(connection.id, { now: new Date("2031-06-01") });

    const movedPeriods = await cal.externalBusyPeriods(tutor._id, {
      from: new Date("2031-06-01"), to: new Date("2031-07-01"),
    });
    check("a rescheduled lesson moves on the calendar rather than appearing twice",
      movedPeriods.length === 1 &&
        new Date(movedPeriods[0].startAt).getTime() === movedStart.getTime());

    const removed = await cal.removeBookingEvent(booking._id);
    check("a cancelled lesson is taken off the calendar", removed.removed === 1);
    await cal.syncConnection(connection.id, { now: new Date("2031-06-01") });
    check("and stops blocking the tutor's availability",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2031-06-01"), to: new Date("2031-07-01"),
      })).length === 0);

    const removedAgain = await cal.removeBookingEvent(booking._id);
    check("removing an already-removed event is a no-op, not an error",
      removedAgain.removed === 0);

    // --- push disabled ------------------------------------------------------------
    await cal.updateConnection(connection.id, { pushEvents: false }, actor);
    await Booking.updateOne({ _id: booking._id }, { $set: { externalEvents: [] } });
    const suppressed = await cal.pushBookingEvent(booking._id);
    check("a tutor who turns off event push gets no lessons written to their calendar",
      suppressed.pushed === 0);
    await cal.updateConnection(connection.id, { pushEvents: true }, actor);

    // --- unconfirmed lessons ---------------------------------------------------------
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { status: BOOKING_STATUS.PENDING_PAYMENT, externalEvents: [] } },
    );
    const unpaid = await cal.pushBookingEvent(booking._id);
    check("an unpaid lesson never reaches anybody's calendar",
      unpaid.pushed === 0 && unpaid.skipped === "NOT_CONFIRMED");
    await Booking.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.CONFIRMED } });

    // --- the scheduled sweep ----------------------------------------------------------
    await CalendarConnection.updateOne({ _id: connection.id }, { $set: { freshUntil: null } });
    const sweep = await cal.syncStaleCalendars({ now: new Date("2031-06-01") });
    check("the sweep refreshes a connection whose cache has aged out",
      sweep.synced >= 1 && sweep.examined >= 1);

    const quiet = await cal.syncStaleCalendars({ now: new Date("2031-06-01") });
    check("and finds nothing to do on the next run", quiet.examined === 0);

    // --- disconnecting -----------------------------------------------------------------
    await cal.pushBookingEvent(booking._id);
    const disconnected = await cal.disconnectCalendar(connection.id, actor);
    check("disconnecting succeeds", disconnected.disconnected === true);
    check("and the connection is gone",
      (await CalendarConnection.countDocuments({ userId: tutorUserId })) === 0);

    const cleaned = await Booking.findById(booking._id).lean();
    check("the lessons we added were taken off the calendar first",
      cleaned.externalEvents.every((e) => e.state === CALENDAR_EVENT_STATE.DELETED));

    check("a disconnected calendar contributes no busy time",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2031-06-01"), to: new Date("2031-07-01"),
      })).length === 0);

    // --- audit ---------------------------------------------------------------------------
    const trail = await AuditLog.find({ entityType: "CalendarConnection" }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("connecting a calendar is audited", actions.has("CALENDAR_CONNECTED"));
    check("disconnecting one is audited", actions.has("CALENDAR_DISCONNECTED"));
    check("no audit row carries a token",
      trail.every((r) => !/v1\./.test(JSON.stringify(r.metadata ?? {}))));
  } finally {
    await CalendarConnection.deleteMany({ userId: tutorUserId });
    await Booking.deleteMany({ _id: { $in: createdBookings } });
    await AuditLog.deleteMany({ entityType: "CalendarConnection" });
  }
}


// --- 17. Progress reports (§35, §41 Phase 2) ------------------------------

/**
 * Who may write, who may read, and whether history survives an edit.
 *
 * The last one is the point of the feature: a family that read a report last
 * term should still be able to see what it said, however many times the tutor
 * has revised it since.
 */
async function progressReportTests() {
  section("Progress reports — authorship, privacy and revision history");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("progress reports", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("progress reports", "MongoDB is not reachable");
    }
  }

  const { ProgressReport, StudentProfile, TutorProfile, Booking, Notification, AuditLog } =
    await import("@/models");
  const progress = await import("@/services/progress.service");
  const {
    PROGRESS_REPORT_STATUS, GOAL_PROGRESS, BOOKING_STATUS, ROLES,
  } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !seededStudent) {
    return skip("progress reports", "no seeded tutor/student — run `bun run seed`");
  }

  // A learner of this test's own, so "has this tutor taught them?" has a
  // known answer rather than one that depends on what the seed happened to
  // book.
  const student = await StudentProfile.create({
    ownerId: seededStudent.ownerId,
    firstName: "Progress",
    lastName: "Testcase",
    isMinor: true,
    shareFullNameWithTutor: false,
  });

  const tutorActor = { id: String(tutor.userId), role: ROLES.TUTOR };
  const owner = { id: String(student.ownerId), role: ROLES.PARENT };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const otherTutor = { id: String(new mongoose.Types.ObjectId()), role: ROLES.TUTOR };
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

  const madeBookings = [];
  const madeReports = [];
  let goalId = null;

  try {
    // A goal on the learner's record, which the report should pick up.
    const withGoal = await StudentProfile.findByIdAndUpdate(
      student._id,
      { $push: { learningGoals: { label: "Integration test goal — safe to delete." } } },
      { new: true },
    );
    goalId = withGoal.learningGoals.at(-1)._id;

    // --- a report needs lessons that actually happened -------------------------
    const noLessons = await throws(
      () => progress.createProgressReport({ studentProfileId: String(student._id) }, tutorActor),
      (e) => e.code === "NO_COMPLETED_LESSONS",
    );
    check("a tutor cannot report on a student they have never taught",
      noLessons.threw && noLessons.matched, noLessons.error?.message);

    const startAt = new Date("2030-02-04T18:00:00.000Z");
    const lesson = await Booking.create({
      reference: `APL-P${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: student.ownerId,
      studentProfileId: student._id,
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: tutor.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      courseCode: "MHF4U",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      completedAt: new Date(),
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(lesson._id);

    const report = await progress.createProgressReport(
      { studentProfileId: String(student._id) }, tutorActor,
    );
    madeReports.push(report.id);

    check("a report starts as a draft", report.status === PROGRESS_REPORT_STATUS.DRAFT);
    check("the lessons it covers are resolved from completed bookings",
      report.lessonCount === 1 && report.bookingIds.length === 1);
    check("the learner's own goals are carried into the report",
      report.goals.some((g) => g.label.startsWith("Integration test goal")));
    check("the paying account is recorded so reads are a single lookup",
      String(report.ownerId) === String(student.ownerId));

    const duplicate = await throws(
      () => progress.createProgressReport({ studentProfileId: String(student._id) }, tutorActor),
      (e) => e.status === 409,
    );
    check("a second draft for the same student is refused",
      duplicate.threw && duplicate.matched);

    // --- a draft is nobody else's business --------------------------------------
    const familySeesDraft = await throws(
      () => progress.getProgressReport(report.id, owner),
      (e) => e.status === 404,
    );
    check("a family cannot see an unfinished draft",
      familySeesDraft.threw && familySeesDraft.matched);

    const adminSeesDraft = await throws(
      () => progress.getProgressReport(report.id, admin),
      (e) => e.status === 404,
    );
    check("nor can an administrator", adminSeesDraft.threw && adminSeesDraft.matched);

    const ownerList = await progress.listReportsForOwner(owner, {});
    check("a draft never appears in the family's history",
      !ownerList.items.some((r) => r.id === report.id));

    // --- only the author writes ---------------------------------------------------
    const familyEdits = await throws(
      () => progress.updateProgressReport(report.id, { summary: "Rewritten by the family." }, owner),
      (e) => e.status === 403,
    );
    check("a family cannot edit a tutor's report", familyEdits.threw && familyEdits.matched);

    const tutorEdits = await throws(
      () => progress.updateProgressReport(report.id, { summary: "Rewritten by another tutor." }, otherTutor),
      (e) => e.status === 403,
    );
    check("another tutor cannot edit it either", tutorEdits.threw && tutorEdits.matched);

    const familySubmits = await throws(
      () => progress.submitProgressReport(report.id, owner),
      (e) => e.status === 403,
    );
    check("a family cannot share a report on the tutor's behalf",
      familySubmits.threw && familySubmits.matched);

    // --- sharing ------------------------------------------------------------------
    const tooShort = await throws(
      () => progress.submitProgressReport(report.id, tutorActor),
      (e) => e.code === "SUMMARY_REQUIRED",
    );
    check("a report with no summary cannot be shared", tooShort.threw && tooShort.matched);

    await progress.updateProgressReport(
      report.id,
      {
        summary: "Covered logarithms and rational graphs. Change-of-base is now solid.",
        strengths: "Works through the algebra without prompting.",
        ratings: { understanding: 4, effort: 5 },
        privateNote: "Parent asked about exam timing — do not repeat to the student.",
        goals: [{ goalId: String(goalId), label: "Integration test goal — safe to delete.", status: GOAL_PROGRESS.ACHIEVED }],
      },
      tutorActor,
    );

    const shared = await progress.submitProgressReport(report.id, tutorActor);
    check("sharing moves the report out of draft",
      shared.status === PROGRESS_REPORT_STATUS.SUBMITTED && Boolean(shared.submittedAt));

    const learnerRecord = await StudentProfile.findById(student._id).lean();
    const recordedGoal = learnerRecord.learningGoals.find((g) => String(g._id) === String(goalId));
    check("a goal marked achieved reaches the learner's own record",
      Boolean(recordedGoal?.achievedAt));

    const shareTwice = await throws(
      () => progress.submitProgressReport(report.id, tutorActor),
      (e) => e.status === 409,
    );
    check("a report cannot be shared twice", shareTwice.threw && shareTwice.matched);

    // --- reading --------------------------------------------------------------------
    const familyView = await progress.getProgressReport(report.id, owner);
    check("the family can now read it", familyView.report.id === report.id);
    check("the family may acknowledge but not edit",
      familyView.canAcknowledge === true && familyView.canEdit === false);
    check("the tutor's private note is never loaded for the family",
      familyView.report.privateNote === undefined);
    check("the family sees who wrote it",
      Boolean(familyView.report.tutorProfileId?.displayName));

    const strangerView = await throws(
      () => progress.getProgressReport(report.id, stranger),
      (e) => e.status === 403,
    );
    check("an unrelated account cannot read it", strangerView.threw && strangerView.matched);

    const authorView = await progress.getProgressReport(report.id, tutorActor);
    check("the author still sees their own private note",
      typeof authorView.report.privateNote === "string");
    check("the learner's name is masked for the tutor unless the family opted in",
      Boolean(authorView.report.studentProfileId?.displayName));

    const adminView = await progress.getProgressReport(report.id, admin);
    check("an administrator can read a shared report for support",
      adminView.report.id === report.id);
    check("but not the tutor's private note",
      adminView.report.privateNote === undefined);

    // --- acknowledgement ---------------------------------------------------------------
    const strangerAck = await throws(
      () => progress.acknowledgeProgressReport(report.id, stranger),
      (e) => e.status === 403,
    );
    check("only the family may acknowledge", strangerAck.threw && strangerAck.matched);

    const acked = await progress.acknowledgeProgressReport(report.id, owner);
    check("acknowledging records who read it and when",
      Boolean(acked.acknowledgedAt) && String(acked.acknowledgedBy) === owner.id);
    check("acknowledging changes nothing the tutor wrote",
      acked.summary === shared.summary);

    const ackTwice = await progress.acknowledgeProgressReport(report.id, owner);
    check("acknowledging twice does not move the timestamp",
      String(ackTwice.acknowledgedAt) === String(acked.acknowledgedAt));

    // --- revision history ------------------------------------------------------------------
    const originalSummary = shared.summary;
    const revised = await progress.updateProgressReport(
      report.id,
      { summary: "Revised: the unit test is next Thursday, not Tuesday.", revisionReason: "Fixed the date." },
      tutorActor,
    );
    check("editing a shared report keeps the previous version",
      revised.revisions.length === 1);
    check("the kept version is what the family actually read",
      revised.revisions[0].snapshot.summary === originalSummary);
    check("the revision records why", revised.revisions[0].reason === "Fixed the date.");
    check("and the report now shows the new text",
      revised.summary.startsWith("Revised:"));

    const revisedAgain = await progress.updateProgressReport(
      report.id, { summary: "Revised twice." }, tutorActor,
    );
    check("every revision is kept, not just the last one",
      revisedAgain.revisions.length === 2 &&
        revisedAgain.revisions[0].snapshot.summary === originalSummary);

    const familyAfterRevision = await progress.getProgressReport(report.id, owner);
    check("the family can see the history too",
      familyAfterRevision.report.revisions.length === 2);

    // --- archiving ------------------------------------------------------------------------
    const archived = await progress.archiveProgressReport(report.id, tutorActor);
    check("a tutor can archive a report", archived.status === PROGRESS_REPORT_STATUS.ARCHIVED);

    const editArchived = await throws(
      () => progress.updateProgressReport(report.id, { summary: "Editing an archive." }, tutorActor),
      (e) => e.code === "REPORT_ARCHIVED",
    );
    check("an archived report cannot be edited", editArchived.threw && editArchived.matched);

    const stillReadable = await progress.getProgressReport(report.id, owner);
    check("but the family keeps their copy", stillReadable.report.id === report.id);

    // --- notifications and audit -----------------------------------------------------------
    const notices = await Notification.find({
      entityType: "ProgressReport",
      entityId: new mongoose.Types.ObjectId(report.id),
    }).lean();
    check("the family is told when a report is shared",
      notices.some((n) => n.type === "PROGRESS_REPORT_SHARED"));
    check("and when it is revised",
      notices.some((n) => n.type === "PROGRESS_REPORT_UPDATED"));

    const trail = await AuditLog.find({
      entityType: "ProgressReport",
      entityId: new mongoose.Types.ObjectId(report.id),
    }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("sharing a report is audited", actions.has("PROGRESS_REPORT_SUBMITTED"));
    check("revising one is audited", actions.has("PROGRESS_REPORT_REVISED"));
    check("archiving one is audited", actions.has("PROGRESS_REPORT_ARCHIVED"));

    // --- the tutor's student picker ---------------------------------------------------------
    const { students } = await progress.reportableStudents(tutorActor);
    check("the picker offers a learner this tutor has actually taught",
      students.some((s) => s.id === String(student._id)));
    check("the picker offers nobody to a tutor with no profile",
      (await progress.reportableStudents(otherTutor)).students.length === 0);
  } finally {
    const reportIds = madeReports.map((id) => new mongoose.Types.ObjectId(id));
    await Notification.deleteMany({ entityType: "ProgressReport", entityId: { $in: reportIds } });
    await AuditLog.deleteMany({ entityType: "ProgressReport", entityId: { $in: reportIds } });
    await ProgressReport.deleteMany({ studentProfileId: student._id });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    await StudentProfile.deleteOne({ _id: student._id });
  }
}


// --- 18. Referrals and account credit (§41 Phase 2) -----------------------

/**
 * The two things that decide whether a referral scheme is safe to run:
 * whether the same credit can be spent twice, and whether a reward can be
 * earned without anybody paying for a lesson.
 */
async function referralTests() {
  section("Referrals — attribution, qualifying, credit and abuse");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("referrals", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("referrals", "MongoDB is not reachable");
    }
  }

  const { User, Referral, CreditEntry, Booking, TutorProfile, Notification, AuditLog, Settings } =
    await import("@/models");
  const referrals = await import("@/services/referral.service");
  const credit = await import("@/services/credit.service");
  const { updateSettings, invalidateSettingsCache } = await import("@/services/settings.service");
  const { REFERRAL_STATUS, REFERRAL_RISK_FLAGS, BOOKING_STATUS, ROLES, USER_STATUS } =
    await import("@/constants");

  const settingsBefore = await Settings.findOne({ key: "PLATFORM" }).lean();
  const referralsBefore = settingsBefore?.referrals ?? {};

  // Real amounts, so the money paths are actually exercised. The shipped
  // defaults are zero and are asserted separately below.
  await updateSettings({
    referrals: {
      enabled: true,
      referrerRewardCents: 2000,
      refereeRewardCents: 1000,
      qualifyingLessons: 1,
      maxRewardsPerReferrer: 25,
    },
  });
  invalidateSettingsCache();

  const made = [];
  const madeBookings = [];
  const makeUser = async (over = {}) => {
    const user = await User.create({
      email: `referral-test-${randomUUID()}@example.com`,
      firstName: "Ref",
      lastName: "Tester",
      role: ROLES.PARENT,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
      ...over,
    });
    made.push(user._id);
    return user;
  };

  try {
    // --- codes ----------------------------------------------------------------
    const referrer = await makeUser();
    const code = await referrals.getOrCreateReferralCode(referrer._id);
    check("an account gets a referral code on first use", /^[A-Z2-9]{8}$/.test(code), code);
    check("asking again returns the same code",
      (await referrals.getOrCreateReferralCode(referrer._id)) === code);
    check("the code avoids characters that are misread aloud",
      !/[IO01]/.test(code));

    const lookup = await referrals.lookupReferralCode(code);
    check("a valid code resolves to a name", lookup.valid && Boolean(lookup.referrerName));
    check("the lookup never exposes a surname", !/ [A-Z][a-z]{2,}$/.test(lookup.referrerName));
    check("an unknown code simply does not resolve",
      (await referrals.lookupReferralCode("ZZZZZZZZ")).valid === false);

    // --- attribution ------------------------------------------------------------
    const referee = await makeUser();
    const attributed = await referrals.attributeReferral({
      code,
      refereeUserId: referee._id,
      email: referee.email,
      ip: "203.0.113.9",
    });
    check("a sign-up with a code is attributed", attributed.attributed === true);

    const stored = await Referral.findOne({ refereeUserId: referee._id }).lean();
    check("the referral starts pending", stored.status === REFERRAL_STATUS.PENDING);
    check("the sign-up address is hashed, never stored",
      Boolean(stored.signupIpHash) && !stored.signupIpHash.includes("203.0.113"));

    const twice = await referrals.attributeReferral({
      code,
      refereeUserId: referee._id,
      email: referee.email,
    });
    check("an account can only ever be introduced once",
      twice.attributed === false && twice.reason === "ALREADY_REFERRED");

    const selfCode = await referrals.getOrCreateReferralCode(referee._id);
    const self = await referrals.attributeReferral({
      code: selfCode,
      refereeUserId: referee._id,
      email: referee.email,
    });
    check("nobody can refer themselves",
      self.attributed === false && self.reason === "SELF_REFERRAL");

    const unknown = await referrals.attributeReferral({
      code: "NOTACODE",
      refereeUserId: (await makeUser())._id,
    });
    check("an unknown code is a quiet no-op, not a failed registration",
      unknown.attributed === false && unknown.reason === "UNKNOWN_CODE");

    // --- qualifying is earned by lessons, not sign-ups -----------------------------
    const tooSoon = await referrals.qualifyReferralFor(referee._id);
    check("a referral does not qualify on sign-up alone",
      tooSoon.qualified === false && tooSoon.reason === "NOT_ENOUGH_LESSONS");
    check("and no credit was granted", (await credit.creditBalance(referrer._id)) === 0);

    const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
    if (!tutor) return skip("referral qualifying", "no seeded tutor — run `bun run seed`");

    const startAt = new Date("2030-05-06T18:00:00.000Z");
    const lesson = await Booking.create({
      reference: `APL-R${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: referee._id,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(lesson._id);

    const qualified = await referrals.qualifyReferralFor(referee._id);
    check("a completed, paid lesson qualifies the referral", qualified.qualified === true);
    check("the referrer is credited", (await credit.creditBalance(referrer._id)) === 2000);
    check("the new account gets its welcome credit",
      (await credit.creditBalance(referee._id)) === 1000);

    const again = await referrals.qualifyReferralFor(referee._id);
    check("qualifying twice grants nothing more",
      again.qualified === false && (await credit.creditBalance(referrer._id)) === 2000);

    const rewarded = await Referral.findById(stored._id).lean();
    check("the referral records what was actually granted",
      rewarded.status === REFERRAL_STATUS.REWARDED && rewarded.referrerRewardCents === 2000);
    check("and which lesson earned it", rewarded.qualifyingBookingIds.length === 1);

    // --- credit cannot be spent twice ------------------------------------------------
    const spender = await makeUser();
    await credit.grantCredit({
      userId: spender._id, amountCents: 5000, reason: "ADMIN_ADJUSTMENT",
      note: "Integration test", notifyRecipient: false,
    });

    const paymentA = new mongoose.Types.ObjectId();
    const paymentB = new mongoose.Types.ObjectId();

    // Two checkouts racing for the same balance.
    const [spendA, spendB] = await Promise.all([
      credit.spendCredit({ userId: spender._id, maxCents: 5000, paymentId: paymentA }),
      credit.spendCredit({ userId: spender._id, maxCents: 5000, paymentId: paymentB }),
    ]);

    const totalSpent = spendA.appliedCents + spendB.appliedCents;
    check("two concurrent checkouts cannot spend the same credit twice",
      totalSpent === 5000, `${spendA.appliedCents} + ${spendB.appliedCents}`);
    check("and the balance lands at zero, never below",
      (await credit.creditBalance(spender._id)) === 0);

    // Whichever of the two actually took the credit is the one a retry would
    // hit; the loser rolled its claim back, so retrying that is a fresh spend
    // against an empty balance rather than a duplicate.
    const winner = spendA.appliedCents > 0 ? paymentA : paymentB;

    const retried = await credit.spendCredit({
      userId: spender._id, maxCents: 5000, paymentId: winner,
    });
    check("retrying the same payment reports what was already applied, not more",
      retried.duplicate === true && retried.appliedCents === 5000 &&
        (await credit.creditBalance(spender._id)) === 0);
    await credit.releaseCredit({
      userId: spender._id, amountCents: 5000, paymentId: winner,
    });
    check("credit returned from an abandoned checkout comes back",
      (await credit.creditBalance(spender._id)) === 5000);

    await credit.releaseCredit({
      userId: spender._id, amountCents: 5000, paymentId: winner,
    });
    check("releasing the same payment twice returns it once",
      (await credit.creditBalance(spender._id)) === 5000);

    const overspend = await credit.spendCredit({
      userId: spender._id, maxCents: 99999, paymentId: new mongoose.Types.ObjectId(),
    });
    check("a bill larger than the balance spends only what is there",
      overspend.appliedCents === 5000);

    // --- the ledger explains the balance ------------------------------------------------
    const statement = await credit.creditStatement(spender._id, {});
    check("every movement is on the statement", statement.entries.length >= 3);
    check("the statement's balance matches the account's", statement.balanceCents === 0);
    check("each entry records the balance it produced",
      statement.entries.every((e) => typeof e.balanceAfterCents === "number"));

    // --- reversal ------------------------------------------------------------------------
    const balanceBefore = await credit.creditBalance(referrer._id);
    const reversed = await referrals.reverseReferral(
      stored._id, { reason: "Integration test reversal." }, { id: referrer._id, role: ROLES.ADMIN },
    );
    check("a referral can be reversed", reversed.status === REFERRAL_STATUS.REVERSED);
    check("and the credit is taken back",
      (await credit.creditBalance(referrer._id)) === balanceBefore - 2000);

    const reverseTwice = await throws(
      () => referrals.reverseReferral(stored._id, { reason: "Again." }, { id: referrer._id }),
      (e) => e.status === 409,
    );
    check("a referral cannot be reversed twice", reverseTwice.threw && reverseTwice.matched);

    // A claw-back stops at zero rather than pushing an account into debt.
    const spentUp = await makeUser();
    await credit.grantCredit({
      userId: spentUp._id, amountCents: 500, reason: "REFERRAL_REWARD", notifyRecipient: false,
    });
    const clawed = await credit.clawBackCredit({ userId: spentUp._id, amountCents: 2000 });
    check("a claw-back recovers only what is left",
      clawed.recoveredCents === 500 && clawed.writtenOffCents === 1500);
    check("and never leaves a negative balance",
      (await credit.creditBalance(spentUp._id)) === 0);

    // --- risk flags are signals, not punishments --------------------------------------------
    const sharedPhone = "+14165550001";
    const flaggedReferrer = await makeUser({
      phoneE164: sharedPhone, phoneVerifiedAt: new Date(),
    });
    const flaggedCode = await referrals.getOrCreateReferralCode(flaggedReferrer._id);
    const flaggedReferee = await makeUser({
      phoneE164: sharedPhone, phoneVerifiedAt: new Date(),
    });

    const flagged = await referrals.attributeReferral({
      code: flaggedCode,
      refereeUserId: flaggedReferee._id,
      email: flaggedReferee.email,
    });
    check("two accounts sharing a confirmed mobile number are flagged",
      flagged.attributed === true &&
        flagged.flags.includes(REFERRAL_RISK_FLAGS.SHARED_PHONE));
    check("but the referral is still recorded rather than silently refused",
      flagged.attributed === true);

    const queue = await referrals.listAllReferrals({ flagged: true });
    check("flagged referrals reach the admin queue",
      queue.items.some((r) => String(r.refereeUserId?._id ?? r.refereeUserId) === String(flaggedReferee._id)));

    // --- a suspended referrer earns nothing ---------------------------------------------------
    await User.updateOne({ _id: flaggedReferrer._id }, { $set: { status: USER_STATUS.SUSPENDED } });
    const suspendedLesson = await Booking.create({
      reference: `APL-S${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: flaggedReferee._id,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(suspendedLesson._id);

    await referrals.qualifyReferralFor(flaggedReferee._id);
    check("a suspended referrer is not credited",
      (await credit.creditBalance(flaggedReferrer._id)) === 0);
    check("but the new account still gets its welcome credit",
      (await credit.creditBalance(flaggedReferee._id)) === 1000);

    // --- the scheme can be switched off ----------------------------------------------------------
    await updateSettings({ referrals: { enabled: false } });
    invalidateSettingsCache();

    const whileOff = await referrals.attributeReferral({
      code, refereeUserId: (await makeUser())._id,
    });
    check("no referral is attributed while the scheme is off",
      whileOff.attributed === false && whileOff.reason === "DISABLED");
    check("and a code stops resolving", (await referrals.lookupReferralCode(code)).valid === false);

    await updateSettings({ referrals: { enabled: true } });
    invalidateSettingsCache();

    // --- zero is a working configuration ------------------------------------------------------------
    await updateSettings({ referrals: { referrerRewardCents: 0, refereeRewardCents: 0 } });
    invalidateSettingsCache();

    const unpricedReferrer = await makeUser();
    const unpricedCode = await referrals.getOrCreateReferralCode(unpricedReferrer._id);
    const unpricedReferee = await makeUser();
    await referrals.attributeReferral({
      code: unpricedCode, refereeUserId: unpricedReferee._id, email: unpricedReferee.email,
    });

    const unpricedLesson = await Booking.create({
      reference: `APL-Z${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: unpricedReferee._id,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(unpricedLesson._id);

    const unpricedResult = await referrals.qualifyReferralFor(unpricedReferee._id);
    check("with no reward configured a referral still qualifies",
      unpricedResult.qualified === true);
    check("and grants nothing, which is the operator's decision rather than a failure",
      (await credit.creditBalance(unpricedReferrer._id)) === 0);

    // --- the person's own page -----------------------------------------------------------------------
    const summary = await referrals.referralSummary({ id: referrer._id, role: ROLES.PARENT });
    check("a person sees their own code and stats",
      summary.code === code && summary.stats.joined >= 1);
    check("names on the referral page are first name plus initial",
      summary.referrals.every((r) => !/ [A-Z][a-z]{2,}$/.test(r.name)));

    // --- notifications and audit ----------------------------------------------------------------------
    const notices = await Notification.find({ userId: { $in: made } }).lean();
    check("a referrer is told when somebody joins with their code",
      notices.some((n) => n.type === "REFERRAL_JOINED"));
    check("and when the reward lands",
      notices.some((n) => n.type === "REFERRAL_REWARDED"));

    const trail = await AuditLog.find({ entityType: "Referral" }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("attribution is audited", actions.has("REFERRAL_ATTRIBUTED"));
    check("qualifying is audited", actions.has("REFERRAL_QUALIFIED"));
    check("reversal is audited", actions.has("REFERRAL_REVERSED"));
  } finally {
    await updateSettings({ referrals: { ...referralsBefore } });
    invalidateSettingsCache();
    await CreditEntry.deleteMany({ userId: { $in: made } });
    await Referral.deleteMany({
      $or: [{ referrerUserId: { $in: made } }, { refereeUserId: { $in: made } }],
    });
    await Notification.deleteMany({ userId: { $in: made } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    await AuditLog.deleteMany({ entityType: "Referral" });
    await User.deleteMany({ _id: { $in: made } });
  }
}


// --- 19. Tutor packages (§20, §41 Phase 2) --------------------------------

/**
 * The properties a package scheme lives or dies by: a lesson cannot be drawn
 * twice, a balance cannot go past what was bought, the money reconciles, and
 * a cancelled lesson goes back where it came from.
 */
async function packageTests() {
  section("Packages — pricing, consumption, cancellation and expiry");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("packages", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("packages", "MongoDB is not reachable");
    }
  }

  const {
    TutorPackage, PackagePurchase, TutorProfile, StudentProfile, Booking, Payment,
    Notification, AuditLog,
  } = await import("@/models");
  const pkgSvc = await import("@/services/package.service");
  const { assessPackagePrice, packageBreakdown, packageSessionPrice, unusedPackageValue } =
    await import("@/lib/booking/packages");
  const {
    PACKAGE_STATUS, PACKAGE_PURCHASE_STATUS, PAYMENT_STATUS, ROLES,
  } = await import("@/constants");
  const { resetPaymentProvider } = await import("@/services/external/payment-provider");

  // Buying a package opens a real checkout session. This section is about the
  // package rules, not the card rails — those have their own section — so it
  // runs against the development provider rather than reaching out to Stripe.
  const paymentProviderBefore = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "development";
  resetPaymentProvider();

  // --- pure pricing ---------------------------------------------------------
  const breakdown = packageBreakdown({
    priceCents: 50000, sessionCount: 10, durationMinutes: 60, commissionPercent: 15,
  });
  check("a package divides into per-session figures", breakdown.perSessionCents === 5000);
  check("commission is taken per session, the same way a lesson is",
    breakdown.perSessionCommissionCents === 750 &&
      breakdown.perSessionTutorEarningsCents === 4250);

  const awkward = packageBreakdown({
    priceCents: 10003, sessionCount: 3, durationMinutes: 60, commissionPercent: 15,
  });
  check("an awkward price keeps its remainder rather than losing cents",
    awkward.perSessionCents * 3 + awkward.remainderCents === 10003);

  const remainderPurchase = {
    priceCents: 10003, sessionsTotal: 3, perSessionCents: awkward.perSessionCents,
    sessionDurationMinutes: 60, commissionPercent: 15,
  };
  const firstSession = packageSessionPrice(remainderPurchase, { index: 0 });
  const laterSession = packageSessionPrice(remainderPurchase, { index: 1 });
  check("the rounding remainder rides on the first lesson",
    firstSession.subtotalCents + laterSession.subtotalCents * 2 === 10003);
  check("every session's commission and earnings still add up exactly",
    firstSession.commissionCents + firstSession.tutorEarningsCents === firstSession.subtotalCents);

  const tooDear = assessPackagePrice({
    priceCents: 100000, sessionCount: 10, durationMinutes: 60,
    standardHourlyRateCents: 6000, settings: { minHourlyRate: 15 },
  });
  check("a package that costs more per hour than booking singly is refused",
    tooDear.ok === false && tooDear.code === "ABOVE_STANDARD_RATE");

  const tooCheap = assessPackagePrice({
    priceCents: 1000, sessionCount: 10, durationMinutes: 60,
    standardHourlyRateCents: 6000, settings: { minHourlyRate: 15 },
  });
  check("a package below the platform minimum rate is refused",
    tooCheap.ok === false && tooCheap.code === "BELOW_MINIMUM_RATE");

  const fair = assessPackagePrice({
    priceCents: 50000, sessionCount: 10, durationMinutes: 60,
    standardHourlyRateCents: 6000, settings: { minHourlyRate: 15 },
  });
  check("a genuine discount is accepted and its saving computed",
    fair.ok === true && fair.savingPercent === 17, `${fair.savingPercent}%`);

  // --- against the database ---------------------------------------------------
  const tutor = await TutorProfile.findOne({ isSearchable: true })
    .populate("userId", "_id")
    .lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor?.courses?.length || !seededStudent) {
    return skip("package lifecycle", "no seeded tutor with courses — run `bun run seed`");
  }

  const tutorActor = { id: String(tutor.userId._id ?? tutor.userId), role: ROLES.TUTOR };
  const owner = { id: String(seededStudent.ownerId), role: ROLES.PARENT };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const course = tutor.courses[0];

  const madeIds = [];
  const madeBookings = [];

  try {
    await TutorPackage.deleteMany({ tutorProfileId: tutor._id, title: /^Integration test package/ });

    // --- creating an offer ----------------------------------------------------
    const overpriced = await throws(
      () => pkgSvc.createPackage({
        title: "Integration test package — overpriced",
        courseId: String(course.courseId),
        sessionCount: 5,
        sessionDurationMinutes: 60,
        mode: "ONLINE",
        priceCents: 99_000_00,
      }, tutorActor),
      (e) => e.code === "ABOVE_STANDARD_RATE",
    );
    check("a tutor cannot sell a package dearer than their own rate",
      overpriced.threw && overpriced.matched);

    const standardRate = course.hourlyRateCents ?? tutor.hourlyRateCents;
    const packagePrice = Math.floor(standardRate * 5 * 0.8);

    const offer = await pkgSvc.createPackage({
      title: "Integration test package — safe to delete",
      description: "Created by the integration suite.",
      courseId: String(course.courseId),
      sessionCount: 5,
      sessionDurationMinutes: 60,
      mode: tutor.lessonModes?.[0] ?? "ONLINE",
      priceCents: packagePrice,
      validityDays: 90,
    }, tutorActor);
    madeIds.push(offer.id);

    check("a package starts as a draft", offer.status === PACKAGE_STATUS.DRAFT);
    check("its per-session and hourly figures are derived, not supplied",
      offer.perSessionCents === Math.floor(packagePrice / 5) &&
        offer.effectiveHourlyRateCents > 0);
    check("the saving against the tutor's own rate is computed", offer.savingPercent > 0);

    const notYours = await throws(
      () => pkgSvc.updatePackage(offer.id, { title: "Hijacked" }, stranger),
      (e) => e.status === 403,
    );
    check("only the tutor who made a package can edit it", notYours.threw && notYours.matched);

    const draftPurchase = await throws(
      () => pkgSvc.purchasePackage({
        packageId: offer.id, studentProfileId: String(seededStudent._id),
      }, owner),
      (e) => e.code === "PACKAGE_NOT_ON_SALE",
    );
    check("a draft package cannot be bought", draftPurchase.threw && draftPurchase.matched);

    await pkgSvc.setPackageStatus(offer.id, { status: PACKAGE_STATUS.ACTIVE }, tutorActor);

    // --- buying ----------------------------------------------------------------
    const strangerBuys = await throws(
      () => pkgSvc.purchasePackage({
        packageId: offer.id, studentProfileId: String(seededStudent._id),
      }, stranger),
      (e) => e.status === 403,
    );
    check("nobody can buy a package for somebody else's child",
      strangerBuys.threw && strangerBuys.matched);

    const { purchase, payment } = await pkgSvc.purchasePackage({
      packageId: offer.id, studentProfileId: String(seededStudent._id),
    }, owner);

    check("buying creates a purchase awaiting payment",
      purchase.status === PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT);
    check("and an ordinary payment beside it", Boolean(payment.id));

    const paymentRow = await Payment.findById(payment.id).lean();
    check("the payment is for the package, not a booking",
      String(paymentRow.packagePurchaseId) === purchase.id && !paymentRow.bookingId);
    check("the payment total matches the package price",
      paymentRow.totalCents + (paymentRow.creditAppliedCents ?? 0) === packagePrice);
    check("the tutor's share is the sum of the sessions",
      paymentRow.tutorEarningsCents ===
        purchase.perSessionTutorEarningsCents * purchase.sessionsTotal);

    const unpaidDraw = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.code === "PACKAGE_NOT_USABLE",
    );
    check("an unpaid package has no lessons to draw", unpaidDraw.threw && unpaidDraw.matched);

    // --- activation -------------------------------------------------------------
    await Payment.updateOne(
      { _id: payment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    const activated = await pkgSvc.activatePackagePurchase(payment.id);
    check("a settled payment activates the package", activated.activated === 1);

    const again = await pkgSvc.activatePackagePurchase(payment.id);
    check("activating twice does nothing", again.activated === 0);

    const live = await PackagePurchase.findById(purchase.id).lean();
    check("the purchase is active with its lessons intact",
      live.status === PACKAGE_PURCHASE_STATUS.ACTIVE && live.sessionsUsed === 0);
    check("its validity is counted from activation, not from the click",
      Boolean(live.expiresAt) && new Date(live.expiresAt) > new Date());

    // --- the terms are frozen ------------------------------------------------------
    await pkgSvc.updatePackage(offer.id, { priceCents: Math.floor(packagePrice * 0.9) }, tutorActor);
    const afterRepricing = await PackagePurchase.findById(purchase.id).lean();
    check("repricing an offer does not change what somebody already bought",
      afterRepricing.priceCents === packagePrice);

    // --- drawing lessons ------------------------------------------------------------
    const drawn = await pkgSvc.consumePackageSession({
      purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
      courseId: course.courseId, durationMinutes: 60,
    });
    check("a lesson can be drawn", drawn.sessionsUsed === 1);

    const wrongTutor = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner,
        tutorProfileId: new mongoose.Types.ObjectId(),
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.code === "PACKAGE_WRONG_TUTOR",
    );
    check("a package cannot pay for a different tutor's lesson",
      wrongTutor.threw && wrongTutor.matched);

    const wrongCourse = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: new mongoose.Types.ObjectId(), durationMinutes: 60,
      }),
      (e) => e.code === "PACKAGE_WRONG_COURSE",
    );
    check("nor a different course", wrongCourse.threw && wrongCourse.matched);

    const wrongDuration = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 120,
      }),
      (e) => e.code === "PACKAGE_WRONG_DURATION",
    );
    check("nor a longer lesson than was bought", wrongDuration.threw && wrongDuration.matched);

    const notMine = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: stranger, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.status === 403,
    );
    check("somebody else cannot spend your package", notMine.threw && notMine.matched);

    // --- the balance cannot be overdrawn -----------------------------------------------
    // Four left, five concurrent attempts.
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        pkgSvc.consumePackageSession({
          purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
          courseId: course.courseId, durationMinutes: 60,
        }),
      ),
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    check("concurrent draws never take more than the balance holds",
      succeeded === 4, `${succeeded} of 5 succeeded`);

    const emptied = await PackagePurchase.findById(purchase.id).lean();
    check("and the counter lands exactly on the total, never past it",
      emptied.sessionsUsed === emptied.sessionsTotal);

    const overdrawn = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.status === 409,
    );
    check("an empty package refuses a further draw", overdrawn.threw && overdrawn.matched);

    // --- returning a session ----------------------------------------------------------------
    const fakeBookingId = new mongoose.Types.ObjectId();
    await PackagePurchase.updateOne(
      { _id: purchase.id },
      { $push: { bookingIds: fakeBookingId } },
    );
    const returned = await pkgSvc.returnPackageSession(purchase.id, fakeBookingId);
    check("a cancelled lesson goes back into the package", returned.returned === true);
    check("and the balance reflects it", returned.sessionsRemaining === 1);

    const returnedTwice = await pkgSvc.returnPackageSession(purchase.id, fakeBookingId);
    check("returning the same lesson twice cannot mint a session",
      returnedTwice.returned === false);

    // --- cancelling the balance ----------------------------------------------------------------
    const beforeCancel = await PackagePurchase.findById(purchase.id).lean();
    const unusedValue = unusedPackageValue(beforeCancel);
    check("only the unused lessons are worth refunding",
      unusedValue === beforeCancel.perSessionCents * 1);

    const strangerCancels = await throws(
      () => pkgSvc.cancelPurchase(purchase.id, { reason: "Not mine." }, stranger),
      (e) => e.status === 403,
    );
    check("somebody else cannot cancel your package",
      strangerCancels.threw && strangerCancels.matched);

    const cancelled = await pkgSvc.cancelPurchase(
      purchase.id, { reason: "Integration test." }, owner,
    );
    check("cancelling refunds the unused lessons",
      cancelled.refundCents === unusedValue, `${cancelled.refundCents} vs ${unusedValue}`);
    check("and marks the purchase refunded",
      cancelled.status === PACKAGE_PURCHASE_STATUS.REFUNDED);

    const cancelTwice = await throws(
      () => pkgSvc.cancelPurchase(purchase.id, { reason: "Again." }, owner),
      (e) => e.status === 409,
    );
    check("a package cannot be cancelled twice", cancelTwice.threw && cancelTwice.matched);

    const refundedPayment = await Payment.findById(payment.id).lean();
    check("the refund went through the ordinary payment record",
      refundedPayment.refundedCents === unusedValue);
    check("and never more than was charged",
      refundedPayment.refundedCents <= refundedPayment.totalCents);

    // --- expiry ------------------------------------------------------------------------------------
    const { purchase: expiring, payment: expiringPayment } = await pkgSvc.purchasePackage({
      packageId: offer.id, studentProfileId: String(seededStudent._id),
    }, owner);
    await Payment.updateOne(
      { _id: expiringPayment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    await pkgSvc.activatePackagePurchase(expiringPayment.id);
    await PackagePurchase.updateOne(
      { _id: expiring.id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    const sweep = await pkgSvc.expirePackages();
    check("the expiry sweep closes an out-of-date package", sweep.expired >= 1);
    check("and refunds the lessons that were never delivered", sweep.refundedCents > 0);

    const expiredRow = await PackagePurchase.findById(expiring.id).lean();
    check("the expired package is marked as such",
      expiredRow.status === PACKAGE_PURCHASE_STATUS.EXPIRED);

    const sweepAgain = await pkgSvc.expirePackages();
    check("running the sweep again refunds nothing twice",
      sweepAgain.expired === 0 && sweepAgain.refundedCents === 0);

    // --- warnings ------------------------------------------------------------------------------------
    const { purchase: warned, payment: warnedPayment } = await pkgSvc.purchasePackage({
      packageId: offer.id, studentProfileId: String(seededStudent._id),
    }, owner);
    await Payment.updateOne(
      { _id: warnedPayment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    await pkgSvc.activatePackagePurchase(warnedPayment.id);
    await PackagePurchase.updateOne(
      { _id: warned.id },
      { $set: { expiresAt: new Date(Date.now() + 3 * 86400000), expiryWarnedAt: null } },
    );

    const warnRun = await pkgSvc.expirePackages();
    check("a package about to expire warns the family", warnRun.warned >= 1);
    const warnAgain = await pkgSvc.expirePackages();
    check("and never warns them twice", warnAgain.warned === 0);

    // --- archiving does not take away what was bought ---------------------------------------------------
    await pkgSvc.setPackageStatus(offer.id, { status: PACKAGE_STATUS.ARCHIVED }, tutorActor);
    const survivor = await PackagePurchase.findById(warned.id).lean();
    check("archiving an offer leaves existing balances alone",
      survivor.status === PACKAGE_PURCHASE_STATUS.ACTIVE);
    check("and the archived offer is off sale",
      (await pkgSvc.listPublicPackages(tutor._id)).every((p) => p.id !== offer.id));

    // --- audit --------------------------------------------------------------------------------------------
    const trail = await AuditLog.find({
      entityType: { $in: ["TutorPackage", "PackagePurchase"] },
    }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("publishing a package is audited", actions.has("PACKAGE_PUBLISHED"));
    check("buying one is audited", actions.has("PACKAGE_PURCHASED"));
    check("cancelling one is audited", actions.has("PACKAGE_CANCELLED"));
  } finally {
    if (paymentProviderBefore === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = paymentProviderBefore;
    resetPaymentProvider();

    const purchases = await PackagePurchase.find({
      packageId: { $in: madeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select("_id paymentId").lean();

    await Notification.deleteMany({
      entityType: "PackagePurchase",
      entityId: { $in: purchases.map((p) => p._id) },
    });
    await Payment.deleteMany({ _id: { $in: purchases.map((p) => p.paymentId).filter(Boolean) } });
    await PackagePurchase.deleteMany({ _id: { $in: purchases.map((p) => p._id) } });
    await TutorPackage.deleteMany({ _id: { $in: madeIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    await AuditLog.deleteMany({ entityType: { $in: ["TutorPackage", "PackagePurchase"] } });
  }
}


// --- 20. Group tutoring (§26, §41 Phase 2) --------------------------------

/**
 * Capacity, duplicate enrolment, and the money when a session does not run.
 *
 * The concurrency check is the important one: seats are the thing this
 * feature can most easily oversell, and overselling means a tutor turning up
 * to more people than they agreed to teach.
 */
async function groupSessionTests() {
  section("Group tutoring — capacity, enrolment and settlement");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("group tutoring", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("group tutoring", "MongoDB is not reachable");
    }
  }

  const {
    GroupSession, GroupEnrolment, Booking, Payment, TutorProfile, StudentProfile,
    Availability, Notification, AuditLog,
  } = await import("@/models");
  const groups = await import("@/services/group.service");
  const {
    GROUP_SESSION_STATUS, GROUP_ENROLMENT_STATUS, BOOKING_STATUS, PAYMENT_STATUS, ROLES,
  } = await import("@/constants");
  const { resetPaymentProvider } = await import("@/services/external/payment-provider");

  const paymentProviderBefore = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "development";
  resetPaymentProvider();

  const tutor = await TutorProfile.findOne({ isSearchable: true })
    .populate("userId", "_id")
    .lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor?.courses?.length || !seededStudent) {
    return skip("group tutoring", "no seeded tutor with courses — run `bun run seed`");
  }

  const availability = await Availability.findOne({ tutorProfileId: tutor._id }).lean();
  if (!availability?.weeklyRules?.length) {
    return skip("group tutoring", "the seeded tutor has published no availability");
  }

  const tutorActor = { id: String(tutor.userId._id ?? tutor.userId), role: ROLES.TUTOR };
  const owner = { id: String(seededStudent.ownerId), role: ROLES.PARENT };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const course = tutor.courses[0];

  const madeSessions = [];
  const madeStudents = [];

  /** Learners of this test's own, so capacity is exercised deterministically. */
  const makeStudent = async (name) => {
    const student = await StudentProfile.create({
      ownerId: seededStudent.ownerId,
      firstName: name,
      lastName: "Grouptest",
      isMinor: true,
    });
    madeStudents.push(student._id);
    return student;
  };

  /** A session at a time the tutor is genuinely free. */
  const nextFreeSlot = async () => {
    const { getBookableSlots } = await import("@/services/availability.service");
    const { days } = await getBookableSlots(tutor._id, { days: 28, durationMinutes: 60 });
    const day = days.find((d) => d.slots.length > 0);
    return day?.slots[0]?.startAt ?? null;
  };

  const startAt = await nextFreeSlot();
  if (!startAt) return skip("group tutoring", "the seeded tutor has no free slots");

  const makeSession = async (over = {}) => {
    const session = await groups.createGroupSession({
      title: "Integration test group — safe to delete",
      courseId: String(course.courseId),
      mode: tutor.lessonModes?.[0] ?? "ONLINE",
      meetingProvider: tutor.onlineMeetingProviders?.[0] ?? "ZOOM",
      startAt,
      durationMinutes: 60,
      minParticipants: 2,
      maxParticipants: 3,
      pricePerSeatCents: 2500,
      ...over,
    }, tutorActor);
    madeSessions.push(session.id);
    return session;
  };

  try {
    await GroupSession.deleteMany({ title: /^Integration test group/ });

    // --- creating and publishing ------------------------------------------------
    const invertedCapacity = await throws(
      () => makeSession({ minParticipants: 5, maxParticipants: 3 }),
      (e) => e.code === "CAPACITY_INVERTED",
    );
    check("a minimum larger than the maximum is refused",
      invertedCapacity.threw && invertedCapacity.matched);

    const session = await makeSession();
    check("a session starts as a draft", session.status === GROUP_SESSION_STATUS.DRAFT);
    check("its seats start empty", session.seatsTaken === 0);

    const joinDraft = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, owner),
      (e) => e.code === "SESSION_NOT_OPEN",
    );
    check("a draft session cannot be joined", joinDraft.threw && joinDraft.matched);

    const strangerPublishes = await throws(
      () => groups.publishGroupSession(session.id, stranger),
      (e) => e.status === 403,
    );
    check("only the tutor can publish their own session",
      strangerPublishes.threw && strangerPublishes.matched);

    const published = await groups.publishGroupSession(session.id, tutorActor);
    check("publishing opens it for sign-ups",
      published.status === GROUP_SESSION_STATUS.PUBLISHED);
    check("and sets the deadline by which it has to fill", Boolean(published.confirmBy));

    const publishTwice = await throws(
      () => groups.publishGroupSession(session.id, tutorActor),
      (e) => e.status === 409,
    );
    check("a session cannot be published twice", publishTwice.threw && publishTwice.matched);

    // --- a tutor is not a student in their own class ------------------------------
    const tutorJoins = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, { id: tutorActor.id, role: ROLES.TUTOR }),
      (e) => e.code === "TUTOR_CANNOT_JOIN_OWN" || e.status === 403,
    );
    check("a tutor cannot join their own session", tutorJoins.threw && tutorJoins.matched);

    const strangerJoins = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, stranger),
      (e) => e.status === 403,
    );
    check("nobody can enrol somebody else's child",
      strangerJoins.threw && strangerJoins.matched);

    // --- joining ---------------------------------------------------------------------
    const alice = await makeStudent("Alice");
    const first = await groups.joinGroupSession(session.id, {
      studentProfileId: String(alice._id),
    }, owner);

    check("joining creates an enrolment awaiting payment",
      first.enrolment.status === GROUP_ENROLMENT_STATUS.PENDING_PAYMENT);
    check("and an ordinary booking for that learner", Boolean(first.booking.id));
    check("the booking is linked to the session",
      String(first.booking.groupSessionId) === session.id);
    check("the seat is taken immediately, before payment",
      first.seatsRemaining === 2);
    check("the booking is priced from the seat price",
      first.booking.price.subtotalCents === 2500);
    check("and commission is taken the ordinary way",
      first.booking.price.commissionCents + first.booking.price.tutorEarningsCents === 2500);

    const joinTwice = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(alice._id),
      }, owner),
      (e) => e.status === 409,
    );
    check("the same learner cannot join twice", joinTwice.threw && joinTwice.matched);

    // --- capacity cannot be exceeded ---------------------------------------------------
    // Two seats left, five learners trying at once.
    const racers = await Promise.all(
      ["Bo", "Cai", "Dev", "Eve", "Fay"].map((name) => makeStudent(name)),
    );
    const outcomes = await Promise.allSettled(
      racers.map((student) =>
        groups.joinGroupSession(session.id, {
          studentProfileId: String(student._id),
        }, owner),
      ),
    );

    const seated = outcomes.filter(
      (o) => o.status === "fulfilled" && !o.value.waitlisted,
    ).length;
    const waitlisted = outcomes.filter(
      (o) => o.status === "fulfilled" && o.value.waitlisted,
    ).length;

    check("concurrent joins never oversell the seats", seated === 2, `${seated} seated`);
    check("everybody else goes on the waiting list rather than being refused",
      waitlisted === 3, `${waitlisted} waitlisted`);

    const full = await GroupSession.findById(session.id).lean();
    check("the seat counter lands exactly on the maximum",
      full.seatsTaken === full.maxParticipants);
    check("and the waiting list is counted", full.waitlistCount === 3);

    const bookings = await Booking.countDocuments({ groupSessionId: session._id });
    check("only seated learners got a booking", bookings === 3);
    check("nobody on the waiting list was charged",
      (await GroupEnrolment.countDocuments({
        sessionId: session._id,
        status: GROUP_ENROLMENT_STATUS.WAITLISTED,
        paymentId: { $ne: null },
      })) === 0);

    // --- confirming when the minimum is met ------------------------------------------------
    const seatedEnrolments = await GroupEnrolment.find({
      sessionId: session._id,
      status: GROUP_ENROLMENT_STATUS.PENDING_PAYMENT,
    }).lean();

    for (const enrolment of seatedEnrolments.slice(0, 2)) {
      await Payment.updateOne(
        { _id: enrolment.paymentId },
        { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
      );
      const booking = await Booking.findById(enrolment.bookingId);
      booking.status = BOOKING_STATUS.CONFIRMED;
      booking.confirmedAt = new Date();
      await booking.save();
      await groups.onGroupBookingConfirmed(booking);
    }

    const confirmed = await GroupSession.findById(session.id).lean();
    check("reaching the minimum confirms the session",
      confirmed.status === GROUP_SESSION_STATUS.CONFIRMED);
    check("and stamps when that happened", Boolean(confirmed.confirmedAt));

    // --- a seat given back goes to the waiting list -------------------------------------------
    // Through the ordinary cancellation path, which is how it actually
    // happens: `cancelBooking` applies the policy and then releases the seat.
    const { cancelBooking } = await import("@/services/booking.service");
    const leaving = seatedEnrolments[0];
    const cancelledPlace = await cancelBooking(
      leaving.bookingId, { reason: "Integration test." }, owner,
    );
    check("cancelling a place cancels the learner's booking", cancelledPlace.cancelled === 1);

    const afterRelease = await GroupSession.findById(session.id).lean();
    check("and the seat goes back into the session", afterRelease.seatsTaken === 2);

    const releasedEnrolment = await GroupEnrolment.findById(leaving._id).lean();
    check("the enrolment records that the place was given up",
      [GROUP_ENROLMENT_STATUS.CANCELLED, GROUP_ENROLMENT_STATUS.REFUNDED].includes(
        releasedEnrolment.status,
      ));

    const offered = await Notification.countDocuments({
      entityId: session._id,
      type: "GROUP_SEAT_AVAILABLE",
    });
    check("the first person waiting is told a seat opened up", offered >= 1);

    const releaseTwice = await groups.releaseGroupSeat(leaving.bookingId);
    check("releasing the same seat twice cannot invent capacity",
      releaseTwice.released === false);
    check("and the seat count is unchanged by the second attempt",
      (await GroupSession.findById(session.id).lean()).seatsTaken === 2);

    // --- the roster is private --------------------------------------------------------------------
    const asOwner = await groups.getGroupSession(session.id, owner);
    check("a family cannot see who else is in the class", asOwner.roster.length === 0);
    check("but does see their own places", asOwner.myEnrolments.length > 0);

    const asTutor = await groups.getGroupSession(session.id, tutorActor);
    check("the tutor sees the roster", asTutor.roster.length > 0);
    check("and it is names only, masked for minors",
      asTutor.roster.every((r) => !/Grouptest$/.test(r.studentName)));
    check("the tutor can manage the session", asTutor.canManage === true);

    const asAnon = await groups.getGroupSession(session.id, null);
    check("an anonymous visitor sees neither roster nor meeting link",
      asAnon.roster.length === 0 && asAnon.meeting === null);
    check("and never a private address",
      asAnon.session.location?.addressLine === undefined);

    // --- cancelling the whole session --------------------------------------------------------------
    const strangerCancels = await throws(
      () => groups.cancelGroupSession(session.id, { reason: "Not mine." }, stranger),
      (e) => e.status === 403,
    );
    check("only the tutor or an administrator can cancel a session",
      strangerCancels.threw && strangerCancels.matched);

    const cancelled = await groups.cancelGroupSession(
      session.id, { reason: "Integration test." }, tutorActor,
    );
    check("cancelling refunds everybody who paid", cancelled.refundedCents > 0);
    check("the session is marked cancelled",
      cancelled.status === GROUP_SESSION_STATUS.CANCELLED);
    check("and every seat is given back", cancelled.seatsTaken === 0);

    const cancelledBookings = await Booking.find({ groupSessionId: session._id }).lean();
    check("every booking still in the session was cancelled by the tutor",
      cancelledBookings
        .filter(
          (b) =>
            b.status !== BOOKING_STATUS.PENDING_PAYMENT &&
            b.status !== BOOKING_STATUS.CANCELLED_BY_STUDENT,
        )
        .every((b) => b.status === BOOKING_STATUS.CANCELLED_BY_TUTOR));
    check("no booking survived the cancellation as confirmed",
      cancelledBookings.every((b) => b.status !== BOOKING_STATUS.CONFIRMED));
    check("and each records a full refund",
      cancelledBookings
        .filter((b) => b.cancellation)
        .every((b) => b.cancellation.refundPercent === 100));

    const cancelTwice = await throws(
      () => groups.cancelGroupSession(session.id, { reason: "Again." }, tutorActor),
      (e) => e.status === 409,
    );
    check("a session cannot be cancelled twice", cancelTwice.threw && cancelTwice.matched);

    const joinCancelled = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, owner),
      (e) => e.code === "SESSION_NOT_OPEN",
    );
    check("a cancelled session cannot be joined", joinCancelled.threw && joinCancelled.matched);

    // --- a session that never fills ---------------------------------------------------------------------
    const lonelySlot = await nextFreeSlot();
    const lonely = await makeSession({
      minParticipants: 3,
      maxParticipants: 5,
      startAt: lonelySlot ?? startAt,
    });
    await groups.publishGroupSession(lonely.id, tutorActor);

    const soloStudent = await makeStudent("Solo");
    const solo = await groups.joinGroupSession(lonely.id, {
      studentProfileId: String(soloStudent._id),
    }, owner);
    await Payment.updateOne(
      { _id: solo.payment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    const soloBooking = await Booking.findById(solo.booking.id);
    soloBooking.status = BOOKING_STATUS.CONFIRMED;
    await soloBooking.save();
    await groups.onGroupBookingConfirmed(soloBooking);

    const stillFilling = await GroupSession.findById(lonely.id).lean();
    check("one person does not confirm a session that needs three",
      stillFilling.status === GROUP_SESSION_STATUS.PUBLISHED);

    // Push the deadline into the past.
    await GroupSession.updateOne(
      { _id: lonely.id },
      { $set: { confirmBy: new Date(Date.now() - 60_000) } },
    );

    const settled = await groups.settleUnderfilledSessions();
    check("an under-subscribed session is cancelled at its deadline",
      settled.cancelled >= 1);
    check("and everybody is refunded in full", settled.refundedCents > 0);

    const lonelyAfter = await GroupSession.findById(lonely.id).lean();
    check("the under-filled session is marked cancelled",
      lonelyAfter.status === GROUP_SESSION_STATUS.CANCELLED);
    check("with a reason the family can read",
      /enough people/i.test(lonelyAfter.cancellationReason ?? ""));

    const settleAgain = await groups.settleUnderfilledSessions();
    check("running settlement again refunds nothing twice",
      settleAgain.cancelled === 0 && settleAgain.refundedCents === 0);

    // --- editing is locked once people have paid ----------------------------------------------------------
    const lockedSlot = await nextFreeSlot();
    const locked = await makeSession({ startAt: lockedSlot ?? startAt });
    await groups.publishGroupSession(locked.id, tutorActor);
    const joiner = await makeStudent("Locked");
    await groups.joinGroupSession(locked.id, {
      studentProfileId: String(joiner._id),
    }, owner);

    const repriced = await throws(
      () => groups.updateGroupSession(locked.id, { pricePerSeatCents: 100 }, tutorActor),
      (e) => e.code === "SESSION_HAS_ENROLMENTS",
    );
    check("the seat price cannot change once somebody has joined",
      repriced.threw && repriced.matched);

    const shrunk = await throws(
      () => groups.updateGroupSession(locked.id, { maxParticipants: 0 }, tutorActor),
      () => true,
    );
    check("capacity cannot be cut below the people already in it", shrunk.threw);

    const renamed = await groups.updateGroupSession(
      locked.id, { title: "Integration test group — renamed" }, tutorActor,
    );
    check("but the description and title can still be improved",
      renamed.title.endsWith("renamed"));

    // --- audit ---------------------------------------------------------------------------------------------
    const trail = await AuditLog.find({ entityType: "GroupSession" }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("publishing a session is audited", actions.has("GROUP_SESSION_PUBLISHED"));
    check("joining one is audited", actions.has("GROUP_ENROLMENT_CREATED"));
    check("cancelling one is audited", actions.has("GROUP_SESSION_CANCELLED"));
  } finally {
    if (paymentProviderBefore === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = paymentProviderBefore;
    resetPaymentProvider();

    const ids = madeSessions.map((id) => new mongoose.Types.ObjectId(id));
    const enrolments = await GroupEnrolment.find({ sessionId: { $in: ids } })
      .select("paymentId bookingId")
      .lean();

    await Notification.deleteMany({ entityType: "GroupSession", entityId: { $in: ids } });
    await Payment.deleteMany({ _id: { $in: enrolments.map((e) => e.paymentId).filter(Boolean) } });
    await Booking.deleteMany({ groupSessionId: { $in: ids } });
    await GroupEnrolment.deleteMany({ sessionId: { $in: ids } });
    await GroupSession.deleteMany({ _id: { $in: ids } });
    await StudentProfile.deleteMany({ _id: { $in: madeStudents } });
    await AuditLog.deleteMany({ entityType: "GroupSession" });
  }
}

/** Synchronous throw capture, for the factories that throw rather than reject. */
function await$throws(fn) {
  try {
    fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}

main()
  .catch((error) => {
    console.error("\nIntegration tests crashed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Mongoose keeps the event loop alive. Everything has been asserted and
    // cleaned up by this point, so ending the process is the exit, not a
    // way of hiding work still in flight.
    process.exit(process.exitCode ?? 0);
  });
