import "server-only";
import { Payment, Payout, WebhookEvent } from "@/models";
import { PAYMENT_STATUS, PAYOUT_STATUS, AUDIT_ACTIONS } from "@/constants";
import { getPaymentProvider } from "./external/payment-provider";
import {
  markPaymentPaid,
  markPaymentFailed,
  recordProviderRefund,
} from "./payment.service";
import { confirmBookings } from "./booking.service";
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
 */

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
  const provider = getPaymentProvider();

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
    if (error?.code === 11000) {
      await WebhookEvent.updateOne(
        { provider: provider.name, eventId: event.id },
        { $inc: { attempts: 1 } },
      );
      return { received: true, duplicate: true, type: event.type };
    }
    throw error;
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
async function resolvePayment(object) {
  const metadataId = object.metadata?.paymentId;
  if (metadataId) {
    const byMetadata = await Payment.findById(metadataId).select("_id").lean();
    if (byMetadata) return byMetadata._id;
  }

  const candidates = [
    object.id?.startsWith("cs_") ? { providerCheckoutId: object.id } : null,
    object.id?.startsWith("pi_") ? { providerPaymentIntentId: object.id } : null,
    object.payment_intent ? { providerPaymentIntentId: idOf(object.payment_intent) } : null,
    object.checkout_session ? { providerCheckoutId: idOf(object.checkout_session) } : null,
  ].filter(Boolean);

  for (const query of candidates) {
    const hit = await Payment.findOne(query).select("_id").lean();
    if (hit) return hit._id;
  }
  return null;
}

/** Settle a payment and confirm its bookings. Safe to run twice. */
async function settle(object, { paymentIntentId, amountCents }) {
  const paymentId = await resolvePayment(object);
  if (!paymentId) return { handled: false, result: "no matching payment" };

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

async function decline(object) {
  const paymentId = await resolvePayment(object);
  if (!paymentId) return { handled: false, result: "no matching payment" };

  const { changed } = await markPaymentFailed(paymentId, {
    failureReason:
      object.last_payment_error?.message ??
      "Your card was declined. Try a different payment method.",
  });

  return {
    handled: true,
    paymentId,
    providerObjectId: object.id,
    result: changed ? "marked failed" : "already settled; failure ignored",
  };
}

/**
 * A checkout session that was never paid. The bookings keep their held slots
 * until the booking service expires them, and the payment stays payable — the
 * purchaser can simply start a new session.
 */
async function expire(object) {
  const paymentId = await resolvePayment(object);
  if (!paymentId) return { handled: false, result: "no matching payment" };

  await Payment.updateOne(
    { _id: paymentId, status: PAYMENT_STATUS.REQUIRES_PAYMENT },
    { $unset: { providerCheckoutUrl: "", checkoutExpiresAt: "" } },
  );

  return { handled: true, paymentId, providerObjectId: object.id, result: "checkout expired" };
}

/**
 * Record the card's brand and last four digits. That is the entire extent of
 * the instrument data this application stores (§35) — never a PAN, never a
 * token that could be charged.
 */
async function describeCard(charge) {
  const card = charge.payment_method_details?.card;
  if (!card) return { handled: false, result: "no card details on charge" };

  const paymentId = await resolvePayment(charge);
  if (!paymentId) return { handled: false, result: "no matching payment" };

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

/** Bring our refund ledger in line with the provider's. */
async function reconcileRefund(charge) {
  const paymentId = await resolvePayment(charge);
  if (!paymentId) return { handled: false, result: "no matching payment" };

  const refunds = charge.refunds?.data ?? [];
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
