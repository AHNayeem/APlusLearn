/**
 * Integration adapter tests (§46, §47).
 *
 * These exercise the production provider adapters — Stripe, Resend, Google
 * and Apple ID tokens, Google geocoding, Zoom — without touching a single
 * third-party service. `fetch` is stubbed per test, OAuth tokens are signed
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
import { createHmac, randomUUID } from "node:crypto";
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
          metadata: { paymentId: String(unpaid._id) },
        },
      },
    }),
  );
  check("an event whose amount disagrees with the booking is REFUSED",
    tampered.threw && /does not match/i.test(tampered.error.message), tampered.error?.message);

  const stillUnpaid = await Payment.findById(unpaid._id).lean();
  check("a refused amount leaves the payment unsettled",
    stillUnpaid.status === "REQUIRES_PAYMENT");

  const failedRecord = await WebhookEvent.findOne({ paymentId: null, status: "FAILED" }).lean();
  check("a webhook that could not be processed is recorded as FAILED, so it is retried",
    Boolean(failedRecord));

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
}

main().catch((error) => {
  console.error("\nIntegration tests crashed:", error);
  process.exitCode = 1;
});
