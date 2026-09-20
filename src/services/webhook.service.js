import "server-only";
import { Payment, Payout, WebhookEvent } from "@/models";
import { PAYMENT_STATUS, PAYOUT_STATUS, AUDIT_ACTIONS } from "@/constants";
import { getPaymentProvider } from "./external/payment-provider";
import {
  markPaymentPaid,
  markPaymentFailed,
  recordProviderRefund,
} from "./payment.service";
import { confirmBookings, releaseBookingsForFailedPayment } from "./booking.service";
import { failureReleasesHold } from "@/lib/booking/policy";
import { applyAccountState, payoutAccountByProviderId } from "./payout.service";
import { recordAudit } from "./audit.service";

/**
 * Payment provider webhooks (§20, §36, §38).
 *
 * This is the only path by which a hosted payment confirms a booking. A
 * browser returning from the provider's page proves nothing — it can be
 * forged, replayed or simply never arrive — so the redirect only shows a
 * status and the money is recognised here, after a signature check.
 *
 * Three properties hold for every event:
 *
 *   verified    the signature is checked against the raw body before the
 *               database is touched at all;
 *   idempotent  a unique index on (provider, eventId) claims each event once,
 *               so a retry or a manual replay is acknowledged and dropped;
 *   ordered-ish events arrive out of order, so each handler is written as a
 *               state assertion rather than a state transition — a late
 *               failure never un-pays a settled payment.
 *   retryable   a delivery that *failed*, or one whose process died holding
 *               the claim, is reprocessed when the provider redelivers it.
 *               Idempotency must not swallow the recovery mechanism.
 */

/**
 * How long a claim may sit in PROCESSING before another delivery may take it
 * over. The provider gives up on its own request in seconds, so anything
 * still "in progress" after this did not survive to finish.
 */
const STUCK_AFTER_MS = 5 * 60 * 1000;

/**
 * Verify, claim and process one webhook delivery.
 *
 * @param {object} args
 * @param {string|Buffer} args.payload  The **raw** request body. Parsing it
 *   before this point would invalidate the signature.
 * @param {string} args.signature       The provider's signature header.
 * @param {boolean} [args.connect]      Connect events use a second endpoint
 *   and a second signing secret.
 */
export async function handlePaymentWebhook({ payload, signature, connect = false }) {
  const provider = await getPaymentProvider();

  // 1. Authenticity. Throws before anything is read or written.
  const event = await provider.verifyWebhook({ payload, signature, connect });

  // 2. Idempotency. The unique index is the lock: whichever delivery inserts
  //    the row first does the work, and the rest collide and stop here.
  let record;
  try {
    record = await WebhookEvent.create({
      provider: provider.name,
      eventId: event.id,
      type: event.type,
      livemode: Boolean(event.livemode),
      status: "PROCESSING",
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;

    // Already seen. Whether that means "stop" depends on how the first
    // attempt ended.
    //
    // A delivery that FAILED must be retryable, or a transient fault — a
    // Mongo blip, a meeting provider that was down for a minute — would
    // wedge that event permanently: the route answers 500, the provider
    // redelivers as designed, and the redelivery gets swallowed here as a
    // duplicate. The redelivery is the recovery mechanism; dropping it
    // throws it away.
    //
    // Re-claiming is safe precisely because every handler below is a state
    // assertion rather than a transition — `markPaymentPaid` no-ops on an
    // already-paid payment, `confirmBookings` on an already-confirmed
    // booking. The conditional update is the lock, so of two simultaneous
    // retries only one gets the row.
    // A row left in PROCESSING is reclaimed on the same reasoning, but only
    // once it is old enough to be certain nobody is still working on it. The
    // provider abandons its own request in well under a minute, so a handler
    // that has been "in progress" for `STUCK_AFTER_MS` did not finish — the
    // process was killed, redeployed or scaled away mid-event — and without
    // this it would hold the claim forever and every redelivery would be
    // dropped as a duplicate.
    record = await WebhookEvent.findOneAndUpdate(
      {
        provider: provider.name,
        eventId: event.id,
        $or: [
          { status: "FAILED" },
          { status: "PROCESSING", updatedAt: { $lte: new Date(Date.now() - STUCK_AFTER_MS) } },
        ],
      },
      { $set: { status: "PROCESSING" }, $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );

    if (!record) {
      // PROCESSED, IGNORED, or being worked on by another delivery right now.
      await WebhookEvent.updateOne(
        { provider: provider.name, eventId: event.id },
        { $inc: { attempts: 1 } },
      );
      return { received: true, duplicate: true, type: event.type };
    }
  }

  // 3. Processing.
  try {
    const outcome = await dispatch(event);
    await WebhookEvent.updateOne(
      { _id: record._id },
      {
        $set: {
          status: outcome.handled ? "PROCESSED" : "IGNORED",
          result: outcome.result?.slice(0, 500),
          paymentId: outcome.paymentId,
          payoutId: outcome.payoutId,
          providerObjectId: outcome.providerObjectId,
          processedAt: new Date(),
        },
      },
    );
    return { received: true, duplicate: false, type: event.type, ...outcome };
  } catch (error) {
    // Leave the row FAILED and rethrow: answering non-2xx asks the provider
    // to redeliver, which is what we want for a transient fault.
    await WebhookEvent.updateOne(
      { _id: record._id },
      { $set: { status: "FAILED", result: error.message?.slice(0, 500), processedAt: new Date() } },
    );
    throw error;
  }
}

/** Route one verified event to its handler. */
async function dispatch(event) {
  const object = event.data?.object ?? {};

  switch (event.type) {
    // A hosted checkout finished. This is what confirms a booking.
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return object.payment_status === "paid"
        ? settle(object, {
            paymentIntentId: idOf(object.payment_intent),
            amountCents: object.amount_total,
          })
        : { handled: false, result: `session ${object.payment_status}` };

    // Belt and braces: a payment intent can succeed without a session event.
    case "payment_intent.succeeded":
      return settle(object, { paymentIntentId: object.id, amountCents: object.amount_received });

    case "checkout.session.async_payment_failed":
    case "payment_intent.payment_failed":
      return decline(object);

    case "checkout.session.expired":
      return expire(object);

    // Carries the card brand and last four, which no earlier event does.
    case "charge.succeeded":
    case "charge.updated":
      return describeCard(object);

    // Covers refunds issued from the provider's own dashboard as well as ours.
    //
    // Both shapes are handled because the provider changed which one carries
    // the detail. `charge.refunded` used to arrive with its `refunds` list
    // expanded; from Stripe's 2022-11-15 API version it does not, so the
    // individual refund — and therefore the id this application dedupes on —
    // only appears on the `refund.*` events.
    case "refund.created":
    case "refund.updated":
      return recordOneRefund(object);

    case "charge.refunded":
      return reconcileRefund(object);

    case "account.updated":
      return updateConnectedAccount(object);

    case "transfer.created":
    case "transfer.reversed":
    case "payout.paid":
    case "payout.failed":
      return updatePayout(event.type, object);

    default:
      // Acknowledged so the provider stops retrying something we don't want.
      return { handled: false, result: "unhandled event type" };
  }
}

/**
 * Find the Payment this event is about.
 *
 * Metadata is the reliable route — we put our own id there when the session
 * was created — with the provider's identifiers as the fallback for objects
 * that do not carry it.
 */
const PAYMENT_FIELDS = "_id status providerCheckoutId providerPaymentIntentId providerCheckoutUrl checkoutExpiresAt";

async function resolvePayment(object) {
  const metadataId = object.metadata?.paymentId;
  if (metadataId) {
    // Metadata is attacker-influenced in principle, so it is treated as a
    // *lookup key* and never as an assertion: whatever comes back must still
    // agree with the provider identifiers on the event itself, checked by
    // `eventMatchesPayment()` in the handlers that act destructively.
    const byMetadata = await Payment.findById(metadataId).select(PAYMENT_FIELDS).lean();
    if (byMetadata) return byMetadata;
  }

  const candidates = [
    object.id?.startsWith("cs_") ? { providerCheckoutId: object.id } : null,
    object.id?.startsWith("pi_") ? { providerPaymentIntentId: object.id } : null,
    object.payment_intent ? { providerPaymentIntentId: idOf(object.payment_intent) } : null,
    object.checkout_session ? { providerCheckoutId: idOf(object.checkout_session) } : null,
  ].filter(Boolean);

  for (const query of candidates) {
    const hit = await Payment.findOne(query).select(PAYMENT_FIELDS).lean();
    if (hit) return hit;
  }
  return null;
}

/**
 * Does this event actually belong to this payment?
 *
 * Only the destructive handlers ask. A `paymentId` in metadata is enough to
 * *find* a payment, but not enough to expire its bookings: without this check
 * anyone who could get one signed event delivered — a replay from a test
 * account, a session created against a different payment — could name someone
 * else's payment in metadata and have their lessons released.
 *
 * The event must carry at least one provider identifier we already stored
 * against that payment.
 */
function eventMatchesPayment(object, payment) {
  const presented = new Set(
    [
      object.id,
      idOf(object.payment_intent),
      idOf(object.checkout_session),
      idOf(object.latest_charge),
    ].filter(Boolean),
  );

  return [payment.providerCheckoutId, payment.providerPaymentIntentId]
    .filter(Boolean)
    .some((known) => presented.has(known));
}

/** Settle a payment and confirm its bookings. Safe to run twice. */
async function settle(object, { paymentIntentId, amountCents }) {
  const payment = await resolvePayment(object);
  if (!payment) return { handled: false, result: "no matching payment" };
  const paymentId = payment._id;

  // A payment we have never opened a session for has no identifier to check
  // against, so there is nothing to disagree with; once it has one, the event
  // must name it (§42).
  const identified = Boolean(payment.providerCheckoutId || payment.providerPaymentIntentId);
  if (identified && !eventMatchesPayment(object, payment)) {
    return { handled: false, paymentId, result: "event does not match this payment" };
  }

  const { changed } = await markPaymentPaid(paymentId, {
    paidAt: new Date(),
    paymentIntentId,
    amountCents,
    chargeId: idOf(object.latest_charge),
  });

  if (!changed) {
    return { handled: true, paymentId, result: "already paid", providerObjectId: object.id };
  }

  // Meeting links and confirmation emails happen here, exactly once.
  const { confirmed } = await confirmBookings(paymentId);

  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.PAYMENT_SETTLED,
    entityType: "Payment",
    entityId: paymentId,
    metadata: { amountCents, confirmed, source: "webhook" },
  });

  return {
    handled: true,
    paymentId,
    providerObjectId: object.id,
    result: `settled, ${confirmed} booking(s) confirmed`,
  };
}

/**
 * A declined payment (§20).
 *
 * Whether the held slots go back immediately is `failureReleasesHold()` in
 * lib/booking/policy, not a rule invented here — the short version is that a
 * decline inside a live hosted session is a retry, and a decline with no
 * session left to retry through is an abandonment.
 */
async function decline(object) {
  const payment = await resolvePayment(object);
  if (!payment) return { handled: false, result: "no matching payment" };
  const paymentId = payment._id;

  if (!eventMatchesPayment(object, payment)) {
    return { handled: false, paymentId, result: "event does not match this payment" };
  }

  const { changed } = await markPaymentFailed(paymentId, {
    failureReason:
      object.last_payment_error?.message ??
      "Your card was declined. Try a different payment method.",
  });

  if (!changed) {
    return {
      handled: true,
      paymentId,
      providerObjectId: object.id,
      result: "already settled; failure ignored",
    };
  }

  let released = 0;
  if (failureReleasesHold({ payment })) {
    ({ expired: released } = await releaseBookingsForFailedPayment(paymentId, {
      reason: "payment declined and no checkout session remained",
    }));
  }

  return {
    handled: true,
    paymentId,
    providerObjectId: object.id,
    result: released
      ? `marked failed, ${released} booking(s) released`
      : "marked failed, slots held until the hold lapses",
  };
}

/**
 * A checkout session that was never paid (§19, §20).
 *
 * The provider has declared that session dead, so the slots it was holding go
 * back on the tutor's calendar now rather than waiting for the sweep. Two
 * guards make that safe to act on:
 *
 *   1. the event must name *this payment's current* session. A late delivery
 *      for a session the purchaser has already replaced would otherwise
 *      release a booking they are actively paying for;
 *   2. `releaseBookingsForFailedPayment` refuses a settled payment outright,
 *      so an expiry arriving after a successful payment changes nothing.
 *
 * Re-delivery is harmless: the second run finds nothing in PENDING_PAYMENT
 * left to claim and reports zero.
 */
async function expire(object) {
  const payment = await resolvePayment(object);
  if (!payment) return { handled: false, result: "no matching payment" };
  const paymentId = payment._id;

  if (!eventMatchesPayment(object, payment)) {
    return { handled: false, paymentId, result: "event does not match this payment" };
  }

  if (payment.providerCheckoutId && object.id && payment.providerCheckoutId !== object.id) {
    return {
      handled: false,
      paymentId,
      providerObjectId: object.id,
      result: "superseded session expired; the payment has a newer one",
    };
  }

  await Payment.updateOne(
    { _id: paymentId, status: PAYMENT_STATUS.REQUIRES_PAYMENT },
    { $unset: { providerCheckoutUrl: "", checkoutExpiresAt: "" } },
  );

  const { expired } = failureReleasesHold({ payment, sessionEnded: true })
    ? await releaseBookingsForFailedPayment(paymentId, { reason: "checkout session expired" })
    : { expired: 0 };

  if (expired) {
    await Payment.updateOne(
      { _id: paymentId, status: PAYMENT_STATUS.REQUIRES_PAYMENT },
      { $set: { status: PAYMENT_STATUS.FAILED, failureReason: "Checkout was not completed in time." } },
    );
  }

  return {
    handled: true,
    paymentId,
    providerObjectId: object.id,
    result: `checkout expired, ${expired} booking(s) released`,
  };
}

/**
 * Record the card's brand and last four digits. That is the entire extent of
 * the instrument data this application stores (§35) — never a PAN, never a
 * token that could be charged.
 */
async function describeCard(charge) {
  const card = charge.payment_method_details?.card;
  if (!card) return { handled: false, result: "no card details on charge" };

  const payment = await resolvePayment(charge);
  if (!payment) return { handled: false, result: "no matching payment" };
  const paymentId = payment._id;

  await Payment.updateOne(
    { _id: paymentId },
    {
      $set: {
        paymentMethodBrand: brandLabel(card.brand),
        paymentMethodLast4: card.last4,
        providerChargeId: charge.id,
        ...(charge.receipt_number ? { receiptNumber: charge.receipt_number } : {}),
      },
    },
  );

  return { handled: true, paymentId, providerObjectId: charge.id, result: "card details recorded" };
}

function brandLabel(brand) {
  const labels = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover" };
  return labels[brand] ?? "Card";
}

/**
 * One refund, from a `refund.*` event.
 *
 * `providerRefundId` is the idempotency key inside `recordProviderRefund`, so
 * a refund this application issued itself is already known and records
 * nothing — and the same event arriving three times records it once.
 */
async function recordOneRefund(refund) {
  if (refund.status && refund.status !== "succeeded") {
    return { handled: false, result: `refund ${refund.status}` };
  }

  const payment = await resolvePayment(refund);
  if (!payment) return { handled: false, result: "no matching payment" };

  const { changed } = await recordProviderRefund(payment._id, {
    providerRefundId: refund.id,
    amountCents: refund.amount,
    reason: refund.metadata?.policy ?? "Refunded at the payment provider",
  });

  return {
    handled: true,
    paymentId: payment._id,
    providerObjectId: refund.id,
    result: changed ? "refund recorded" : "refund already known",
  };
}

/** Bring our refund ledger in line with the provider's. */
async function reconcileRefund(charge) {
  const payment = await resolvePayment(charge);
  if (!payment) return { handled: false, result: "no matching payment" };
  const paymentId = payment._id;

  const refunds = charge.refunds?.data;
  if (!refunds) {
    // Unexpanded, as modern API versions send it. The `refund.*` events
    // carry the detail; there is nothing to reconcile from here.
    return {
      handled: false,
      paymentId,
      providerObjectId: charge.id,
      result: "charge carries no expanded refunds; handled by refund.* instead",
    };
  }

  let applied = 0;

  for (const refund of refunds) {
    if (refund.status && refund.status !== "succeeded") continue;
    const { changed } = await recordProviderRefund(paymentId, {
      providerRefundId: refund.id,
      amountCents: refund.amount,
      reason: refund.metadata?.policy ?? "Refunded at the payment provider",
    });
    if (changed) applied += 1;
  }

  return {
    handled: true,
    paymentId,
    providerObjectId: charge.id,
    result: applied ? `${applied} refund(s) recorded` : "refunds already known",
  };
}

/** A tutor's Connect account changed — verified, restricted or disabled. */
async function updateConnectedAccount(account) {
  const stored = await payoutAccountByProviderId(account.id);
  if (!stored) return { handled: false, result: "no matching payout account" };

  const due = [
    ...(account.requirements?.currently_due ?? []),
    ...(account.requirements?.past_due ?? []),
  ];

  await applyAccountState(stored, {
    onboardingStatus:
      account.payouts_enabled && account.details_submitted
        ? "COMPLETE"
        : account.requirements?.disabled_reason
          ? "RESTRICTED"
          : "IN_PROGRESS",
    payoutsEnabled: Boolean(account.payouts_enabled),
    chargesEnabled: Boolean(account.charges_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    bankName: account.external_accounts?.data?.[0]?.bank_name ?? null,
    accountLast4: account.external_accounts?.data?.[0]?.last4 ?? null,
    requirementsDue: [...new Set(due)],
    disabledReason: account.requirements?.disabled_reason ?? null,
  });

  return {
    handled: true,
    providerObjectId: account.id,
    result: `payouts ${account.payouts_enabled ? "enabled" : "disabled"}`,
  };
}

/**
 * Transfer and payout lifecycle.
 *
 * A reversal or a failed bank payout releases the lessons again, exactly as
 * the manual failure path does, so the next run can retry them. The amounts
 * are never recalculated here.
 */
async function updatePayout(type, object) {
  const transferId = object.id?.startsWith("tr_") ? object.id : idOf(object.source_transaction);
  const payout = transferId
    ? await Payout.findOne({ providerTransferId: transferId })
    : null;

  if (!payout) return { handled: false, result: "no matching payout" };

  if (type === "transfer.created" && payout.status === PAYOUT_STATUS.PENDING) {
    payout.status = PAYOUT_STATUS.IN_TRANSIT;
  }
  if (type === "payout.paid") {
    payout.status = PAYOUT_STATUS.PAID;
    payout.paidAt = payout.paidAt ?? new Date();
  }
  if (type === "transfer.reversed" || type === "payout.failed") {
    payout.status = PAYOUT_STATUS.FAILED;
    payout.failureReason = object.failure_message ?? "The transfer was reversed by the provider.";
  }
  await payout.save();

  return {
    handled: true,
    payoutId: payout._id,
    providerObjectId: object.id,
    result: `payout ${payout.status}`,
  };
}

function idOf(value) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

/** Recent deliveries, for the admin integrations panel. */
export async function recentWebhookEvents({ limit = 20 } = {}) {
  const events = await WebhookEvent.find()
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 100))
    .lean();
  return events.map((e) => ({
    id: String(e._id),
    provider: e.provider,
    type: e.type,
    status: e.status,
    result: e.result ?? null,
    attempts: e.attempts,
    livemode: e.livemode,
    createdAt: e.createdAt?.toISOString() ?? null,
  }));
}
