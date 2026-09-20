import "server-only";
import { Types } from "mongoose";
import { Payment, Booking, PayoutAccount, User } from "@/models";
import {
  PAYMENT_STATUS,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, AuthorizationError } from "@/lib/api/errors";
import { requireVerifiedEmail } from "@/lib/auth/assert";
import { toPlain } from "@/lib/utils/serialize";
import { formatMoney } from "@/lib/utils/format";
import { holdMinutes } from "@/lib/booking/policy";
import { getPaymentProvider } from "./external/payment-provider";
import { getSettings } from "./settings.service";
import { spendCredit, releaseCredit } from "./credit.service";
import { reverseReferralsForBooking } from "./referral.service";
import { brandedEmailTemplates } from "./external/email-provider";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import { checkPaymentFailures } from "./risk.service";

/** Absolute URLs a hosted checkout returns the purchaser to. */
function appUrl(path) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * Payments (§20).
 *
 * The provider abstraction never sees a price it was given by a browser: the
 * amounts here come from the Booking documents, which were themselves priced
 * by `lib/booking/pricing`. That is the whole point of the separation.
 */

export async function createPaymentForBooking({ bookings, purchaserId, tutorUserId }) {
  const totals = bookings.reduce(
    (acc, booking) => ({
      subtotalCents: acc.subtotalCents + booking.price.subtotalCents,
      commissionCents: acc.commissionCents + booking.price.commissionCents,
      tutorEarningsCents: acc.tutorEarningsCents + booking.price.tutorEarningsCents,
      totalCents: acc.totalCents + booking.price.totalCents,
    }),
    { subtotalCents: 0, commissionCents: 0, tutorEarningsCents: 0, totalCents: 0 },
  );

  const provider = await getPaymentProvider();

  // The Payment row is written first so the provider's session can carry our
  // id in its metadata. That is what lets a webhook find the right payment
  // without trusting anything the browser sends back.
  const payment = await Payment.create({
    bookingId: bookings[0]._id,
    purchaserId,
    tutorUserId,
    ...totals,
    commissionPercent: bookings[0].price.commissionPercent,
    status: PAYMENT_STATUS.REQUIRES_PAYMENT,
    provider: provider.name,
  });

  // Account credit is applied server-side, from the stored balance, after the
  // price is computed — never from anything the browser sent (§42). The
  // lesson's value and the tutor's earnings are untouched: the platform's
  // commission absorbs the credit, so a discounted booking still pays the
  // tutor in full (§41 Phase 2).
  const credit = await spendCredit({
    userId: purchaserId,
    maxCents: totals.totalCents,
    paymentId: payment._id,
    bookingId: bookings[0]._id,
    note: bookings[0].courseCode
      ? `Applied to ${bookings[0].courseCode}`
      : "Applied to a booking",
  });

  if (credit.appliedCents > 0) {
    payment.creditAppliedCents = credit.appliedCents;
    payment.totalCents = Math.max(0, totals.totalCents - credit.appliedCents);
    await payment.save();
  }

  // The bookings are linked to this payment by the caller a moment from now,
  // so their ids are passed in rather than read back.
  const checkout = await openCheckoutSession(payment, bookings[0], provider, {
    bookingIds: bookings.map((b) => String(b._id)),
  });

  return { ...toPlain(payment), checkoutUrl: checkout.checkoutUrl };
}

/**
 * Create the payment for a package purchase (§41 Phase 2).
 *
 * Deliberately the same function shape, the same provider call, the same
 * checkout session and the same webhook path as a booking. A package is a
 * different thing to buy, not a different way to pay — so the only difference
 * here is which field on the Payment names what was bought.
 */
export async function createPaymentForPackage({ purchase, purchaserId, tutorUserId }) {
  const provider = await getPaymentProvider();

  const payment = await Payment.create({
    packagePurchaseId: purchase._id,
    purchaserId,
    tutorUserId,
    subtotalCents: purchase.priceCents,
    commissionPercent: purchase.commissionPercent,
    commissionCents: purchase.perSessionCommissionCents * purchase.sessionsTotal,
    tutorEarningsCents: purchase.perSessionTutorEarningsCents * purchase.sessionsTotal,
    totalCents: purchase.priceCents,
    status: PAYMENT_STATUS.REQUIRES_PAYMENT,
    provider: provider.name,
  });

  const credit = await spendCredit({
    userId: purchaserId,
    maxCents: purchase.priceCents,
    paymentId: payment._id,
    note: `Applied to ${purchase.title}`,
  });

  if (credit.appliedCents > 0) {
    payment.creditAppliedCents = credit.appliedCents;
    payment.totalCents = Math.max(0, purchase.priceCents - credit.appliedCents);
    await payment.save();
  }

  const checkout = await openCheckoutSession(payment, null, provider, {
    packageTitle: purchase.title,
    reference: purchase.reference,
  });

  return { ...toPlain(payment), checkoutUrl: checkout.checkoutUrl };
}

/**
 * Create a provider checkout session for a payment and record its references.
 *
 * Split out because a hosted session expires: if a parent leaves the tab open
 * over lunch, `checkoutUrlFor()` calls this again rather than showing them a
 * dead page. The amount always comes from the Payment row.
 */
async function openCheckoutSession(payment, booking, provider, { bookingIds, packageTitle, reference } = {}) {
  // Resolving the provider is asynchronous now that its credentials may be
  // stored rather than deployed, so it cannot be a default parameter. Every
  // caller already passes one; this is the belt to that braces.
  provider ??= await getPaymentProvider();

  const [purchaser, settings] = await Promise.all([
    User.findById(payment.purchaserId).select("email paymentCustomerId").lean(),
    getSettings(),
  ]);

  // A package payment has no bookings to name; a lesson payment has at least
  // one, and looks them up when the caller did not pass them.
  const ids = payment.packagePurchaseId
    ? []
    : bookingIds ??
      (await Booking.find({ paymentId: payment._id }).select("_id").lean()).map((b) => String(b._id));

  const checkout = await provider.createCheckout({
    bookingReference: reference ?? booking?.reference ?? String(payment._id),
    amountCents: payment.totalCents,
    currency: payment.currency,
    description: packageTitle
      ? `${packageTitle} — APlus Learn package`
      : booking?.courseName
        ? `${booking.courseName} — APlus Learn lesson`
        : "APlus Learn lessons",
    customerEmail: purchaser?.email,
    customerId: purchaser?.paymentCustomerId ?? undefined,
    successUrl: appUrl(`/bookings/checkout/${payment._id}/complete`),
    cancelUrl: appUrl(`/bookings/checkout/${payment._id}?cancelled=1`),
    // One session per payment attempt: a retried request reuses the session
    // instead of creating a second chargeable one.
    idempotencyKey: `checkout-${payment._id}-${payment.checkoutAttempts ?? 0}`,
    // The provider's session and the booking hold expire together, both from
    // `checkoutHoldMinutes` (§19, §20).
    holdMinutes: holdMinutes(settings),
    metadata: {
      paymentId: String(payment._id),
      bookingIds: ids.join(","),
      ...(payment.packagePurchaseId
        ? { packagePurchaseId: String(payment.packagePurchaseId) }
        : {}),
    },
  });

  payment.providerCheckoutId = checkout.checkoutId;
  payment.providerPaymentIntentId = checkout.paymentIntentId;
  payment.providerCheckoutUrl = checkout.checkoutUrl;
  payment.checkoutExpiresAt = checkout.expiresAt ? new Date(checkout.expiresAt) : undefined;
  payment.livemode = Boolean(checkout.livemode);
  await payment.save();

  // Remember the provider's customer so a returning parent keeps one record.
  if (checkout.customerId && !purchaser?.paymentCustomerId) {
    await User.updateOne(
      { _id: payment.purchaserId },
      { $set: { paymentCustomerId: checkout.customerId } },
    );
  }

  return checkout;
}

/**
 * Where a purchaser should go to pay (§20).
 *
 * With a hosted provider that is the provider's own page, refreshed if the
 * session has lapsed; with the development provider it is the in-app form.
 * Ownership is checked against the loaded record, never a request field.
 */
export async function checkoutUrlFor(paymentId, actor) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  if (String(payment.purchaserId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this payment.");
  }

  const provider = await getPaymentProvider();
  if (!provider.hostedCheckout) return { hosted: false, url: null };

  if (payment.status === PAYMENT_STATUS.PAID) {
    return { hosted: true, url: null, alreadyPaid: true };
  }

  const stale =
    !payment.providerCheckoutUrl ||
    payment.provider !== provider.name ||
    (payment.checkoutExpiresAt && payment.checkoutExpiresAt <= new Date());

  if (stale) {
    const booking = await Booking.findById(payment.bookingId).select("reference courseName").lean();
    payment.provider = provider.name;
    payment.checkoutAttempts = (payment.checkoutAttempts ?? 0) + 1;
    const checkout = await openCheckoutSession(payment, booking, provider);
    return { hosted: true, url: checkout.checkoutUrl };
  }

  return { hosted: true, url: payment.providerCheckoutUrl };
}

/**
 * Complete checkout with the development provider.
 *
 * The card details go straight to the provider and are never persisted — only
 * the brand and last four digits come back (§35). Under a hosted provider
 * this path does not exist: the card is entered on the provider's own page
 * and the booking is confirmed by a verified webhook, never by a browser
 * claiming success.
 */
export async function capturePayment(paymentId, { card }, actor) {
  requireVerifiedEmail(actor, "Confirm your email address before paying for a lesson.");

  const provider = await getPaymentProvider();
  if (provider.hostedCheckout) {
    throw new BusinessRuleError(
      "Card details are entered on our payment provider's secure page. Continue to checkout to complete this payment.",
      "HOSTED_CHECKOUT_REQUIRED",
    );
  }

  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  if (String(payment.purchaserId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this payment.");
  }
  if (payment.status === PAYMENT_STATUS.PAID) {
    return { ...toPlain(payment), alreadyPaid: true };
  }

  payment.status = PAYMENT_STATUS.PROCESSING;
  await payment.save();

  const result = await provider.capturePayment({
    paymentIntentId: payment.providerPaymentIntentId,
    card,
  });

  if (result.status !== "PAID") {
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = result.failureReason;
    await payment.save();
    await checkPaymentFailures({ userId: payment.purchaserId, paymentId: payment._id });
    throw new BusinessRuleError(
      result.failureReason ?? "That payment could not be completed.",
      "PAYMENT_FAILED",
    );
  }

  payment.status = PAYMENT_STATUS.PAID;
  payment.paidAt = new Date(result.paidAt);
  payment.paymentMethodBrand = result.paymentMethodBrand;
  payment.paymentMethodLast4 = result.paymentMethodLast4;
  payment.receiptNumber = result.receiptNumber;
  await payment.save();

  return toPlain(payment);
}

export async function refundPayment(paymentId, { amountCents, reason, issuedBy }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  // Never refund more than was actually collected.
  const refundable = payment.totalCents - (payment.refundedCents ?? 0);
  if (amountCents > refundable) {
    throw new BusinessRuleError(
      `Only ${formatMoney(refundable)} is still refundable on this payment.`,
      "REFUND_EXCEEDS_BALANCE",
    );
  }
  if (payment.status !== PAYMENT_STATUS.PAID && payment.status !== PAYMENT_STATUS.PARTIALLY_REFUNDED) {
    // Nothing was captured, so there is nothing to send back.
    return toPlain(payment);
  }

  const result = await (await getPaymentProvider()).processRefund({
    paymentIntentId: payment.providerPaymentIntentId,
    amountCents,
    reason,
    // A retried cancellation must not refund twice. Keyed on how much has
    // already gone back, so a *second, different* refund is still possible.
    idempotencyKey: `refund-${payment._id}-${payment.refundedCents ?? 0}-${amountCents}`,
  });

  payment.refunds.push({
    amountCents,
    reason,
    issuedBy,
    providerRefundId: result.refundId,
  });
  payment.refundedCents = (payment.refundedCents ?? 0) + amountCents;
  payment.status =
    payment.refundedCents >= payment.totalCents
      ? PAYMENT_STATUS.REFUNDED
      : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  await payment.save();

  // A reward earned by a lesson that has now been refunded is unwound, so a
  // refund cannot be used to keep the credit and the money (§41 Phase 2).
  // Best-effort: a referral problem must never block a refund reaching
  // somebody's card.
  await reverseReferralsForBooking(payment.bookingId, {
    reason: "The qualifying lesson was refunded.",
  }).catch((error) => console.warn("[payment] referral reversal failed:", error.message));

  const purchaser = await User.findById(payment.purchaserId).select("firstName").lean();

  await notify({
    userId: payment.purchaserId,
    type: NOTIFICATION_TYPES.REFUND_ISSUED,
    title: `${formatMoney(amountCents)} refunded`,
    body: reason,
    href: "/payments",
    entityType: "Payment",
    entityId: payment._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
    email: (await brandedEmailTemplates()).refundIssued({
      firstName: purchaser?.firstName ?? "there",
      amountLabel: formatMoney(amountCents),
      reason,
      reference: payment.receiptNumber ?? String(payment._id).slice(-8).toUpperCase(),
    }),
  });

  await recordAudit({
    actor: { id: issuedBy },
    action: AUDIT_ACTIONS.REFUND_ISSUED,
    entityType: "Payment",
    entityId: payment._id,
    metadata: { amountCents, reason },
  });

  return toPlain(payment);
}

/**
 * Ask the provider what actually happened to a payment (§20, §38).
 *
 * The webhook is how a hosted payment is *normally* confirmed, but a webhook
 * can be lost — an endpoint that was down, a forwarder that was not running,
 * a signing secret rotated mid-flight. Left unreconciled that becomes the
 * worst outcome this application has: the purchaser is charged, no event
 * arrives, and the expiry sweep releases the lesson they paid for.
 *
 * So before anything destructive happens to an unpaid booking, the provider
 * is asked directly. That is still the backend as the source of truth — it is
 * the provider's own API answering, not a browser — and it is the only other
 * authority besides the webhook.
 *
 * @returns {Promise<{ status: string, amountCents?: number, paymentIntentId?: string }|null>}
 *   `null` when there is nothing to ask about: the development provider
 *   settles in-app and has no remote state, and a payment with no session
 *   opened yet has no provider object to name.
 */
export async function providerPaymentStatus(payment) {
  const provider = await getPaymentProvider();

  // Only a provider that confirms by webhook has remote state worth reading.
  // The development provider does not, and must never be consulted here.
  if (!provider.confirmsByWebhook) return null;
  if (payment.provider !== provider.name) return null;
  if (!payment.providerPaymentIntentId && !payment.providerCheckoutId) return null;

  return provider.getPaymentStatus({
    paymentIntentId: payment.providerPaymentIntentId ?? undefined,
    checkoutId: payment.providerCheckoutId ?? undefined,
  });
}

/**
 * Mark a payment settled from a verified provider event (§20, §38).
 *
 * The only caller is `webhook.service`, after it has proved the event came
 * from the provider. It is a no-op on a payment that is already PAID, so a
 * replayed or duplicated delivery cannot confirm bookings twice or send a
 * second confirmation email.
 *
 * @returns {{ changed: boolean, payment: object }}
 */
export async function markPaymentPaid(
  paymentId,
  { paidAt, paymentMethodBrand, paymentMethodLast4, receiptNumber, chargeId, paymentIntentId, amountCents } = {},
) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  if (payment.status === PAYMENT_STATUS.PAID) {
    return { changed: false, payment: toPlain(payment) };
  }

  // The provider's figure must match what we priced. A mismatch means the
  // session was tampered with or reused, and is never accepted silently.
  if (amountCents != null && amountCents !== payment.totalCents) {
    throw new BusinessRuleError(
      `Paid amount ${amountCents} does not match the ${payment.totalCents} owed on this payment.`,
      "AMOUNT_MISMATCH",
    );
  }

  payment.status = PAYMENT_STATUS.PAID;
  payment.paidAt = paidAt ? new Date(paidAt) : new Date();
  if (paymentMethodBrand) payment.paymentMethodBrand = paymentMethodBrand;
  if (paymentMethodLast4) payment.paymentMethodLast4 = paymentMethodLast4;
  if (chargeId) payment.providerChargeId = chargeId;
  if (paymentIntentId) payment.providerPaymentIntentId = paymentIntentId;
  payment.receiptNumber =
    receiptNumber ?? payment.receiptNumber ?? `RCPT-${String(payment._id).slice(-8).toUpperCase()}`;
  payment.failureReason = undefined;
  await payment.save();

  return { changed: true, payment: toPlain(payment) };
}

/** Record a declined payment from a verified provider event. */
export async function markPaymentFailed(paymentId, { failureReason } = {}) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  // A payment that already settled is never walked back by a later failure
  // event — those arrive out of order more often than you would like.
  if (payment.status === PAYMENT_STATUS.PAID) {
    return { changed: false, payment: toPlain(payment) };
  }

  payment.status = PAYMENT_STATUS.FAILED;
  payment.failureReason = failureReason ?? "The payment was declined.";
  await payment.save();

  await returnAppliedCredit(payment, "The payment was not completed.");

  // A run of declined payments can be a card being tested rather than a card
  // that expired, so the count is surfaced for review (§41 Phase 2). Keyed on
  // the payment, so a redelivered failure event records nothing extra.
  await checkPaymentFailures({ userId: payment.purchaserId, paymentId: payment._id });

  return { changed: true, payment: toPlain(payment) };
}

/**
 * Give back credit that was applied to a payment which never settled.
 *
 * Idempotent on the payment, twice over: `creditReleasedAt` short-circuits
 * the common case, and the ledger entry carries a key scoped to the payment
 * so even a concurrent second call grants nothing extra (§41 Phase 2).
 */
export async function returnAppliedCredit(payment, note) {
  if (!payment?.creditAppliedCents || payment.creditReleasedAt) return { released: false };

  // A settled payment consumed its credit; only an unpaid one gets it back.
  if (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.PARTIALLY_REFUNDED) {
    return { released: false, reason: "SETTLED" };
  }

  const claimed = await Payment.updateOne(
    { _id: payment._id, creditReleasedAt: null },
    { $set: { creditReleasedAt: new Date() } },
  );
  if (!claimed.modifiedCount) return { released: false, reason: "ALREADY_RELEASED" };

  await releaseCredit({
    userId: payment.purchaserId,
    amountCents: payment.creditAppliedCents,
    paymentId: payment._id,
    note,
  });

  return { released: true, amountCents: payment.creditAppliedCents };
}

/**
 * Reconcile a refund that was issued outside the app — from the provider's
 * own dashboard, or by their fraud tooling.
 *
 * The refund has already happened, so this records rather than requests it.
 * `providerRefundId` is the idempotency key: the same refund arriving twice
 * changes nothing.
 */
export async function recordProviderRefund(paymentId, { providerRefundId, amountCents, reason }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  const known = payment.refunds.some((r) => r.providerRefundId === providerRefundId);
  if (known) return { changed: false, payment: toPlain(payment) };

  payment.refunds.push({
    amountCents,
    reason: reason ?? "Refunded at the payment provider",
    providerRefundId,
  });
  payment.refundedCents = Math.min(
    payment.totalCents,
    (payment.refundedCents ?? 0) + amountCents,
  );
  payment.status =
    payment.refundedCents >= payment.totalCents
      ? PAYMENT_STATUS.REFUNDED
      : PAYMENT_STATUS.PARTIALLY_REFUNDED;
  await payment.save();

  await notify({
    userId: payment.purchaserId,
    type: NOTIFICATION_TYPES.REFUND_ISSUED,
    title: `${formatMoney(amountCents)} refunded`,
    body: "A refund was issued to your original payment method.",
    href: "/payments",
    entityType: "Payment",
    entityId: payment._id,
  });

  return { changed: true, payment: toPlain(payment) };
}

export async function getPayment(id, actor) {
  const payment = await Payment.findById(id)
    .populate("bookingId", "reference courseName courseCode startAt durationMinutes mode status")
    .lean();
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  const allowed =
    actor.role === ROLES.ADMIN ||
    String(payment.purchaserId) === String(actor.id) ||
    String(payment.tutorUserId) === String(actor.id);
  if (!allowed) throw new AuthorizationError("You do not have access to this payment.");

  return toPlain(payment);
}

/** Payment history / transaction list (§24). */
export async function listPayments(actor, { page = 1, pageSize, status } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const query = {};

  if (actor.role === ROLES.ADMIN) {
    // no scoping
  } else if (actor.role === ROLES.TUTOR) {
    query.tutorUserId = actor.id;
  } else {
    query.purchaserId = actor.id;
  }
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    Payment.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("bookingId", "reference courseName courseCode startAt mode status")
      .populate("purchaserId", "firstName lastName email")
      .lean(),
    Payment.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

/** A printable receipt for a paid booking (§20). */
export async function getReceipt(paymentId, actor) {
  const payment = await getPayment(paymentId, actor);
  if (payment.status === PAYMENT_STATUS.REQUIRES_PAYMENT) {
    throw new BusinessRuleError("This booking has not been paid yet.");
  }

  const bookings = await Booking.find({ paymentId })
    .select("reference courseName courseCode startAt endAt durationMinutes mode price status")
    .sort({ startAt: 1 })
    .lean();

  return {
    payment,
    bookings: toPlain(bookings),
    issuedAt: payment.paidAt ?? payment.createdAt,
    receiptNumber: payment.receiptNumber ?? `RCPT-${String(payment.id).slice(-8).toUpperCase()}`,
  };
}

/** Tutor earnings dashboard (§24). */
export async function tutorEarnings(tutorUserId, { days = 90 } = {}) {
  const since = new Date(Date.now() - days * 86400000);

  const matchId = typeof tutorUserId === "string" ? new Types.ObjectId(tutorUserId) : tutorUserId;

  const [totals, period, recent, account] = await Promise.all([
    Booking.aggregate([
      {
        $match: {
          tutorUserId: matchId,
          status: BOOKING_STATUS.COMPLETED,
        },
      },
      {
        $group: {
          _id: null,
          grossCents: { $sum: "$price.subtotalCents" },
          commissionCents: { $sum: "$price.commissionCents" },
          netCents: { $sum: "$price.tutorEarningsCents" },
          lessons: { $sum: 1 },
        },
      },
    ]),
    // Aggregated rather than reduced from `recent` below: that list is capped
    // at 50 rows, so a busy tutor's period total used to stop counting once
    // they passed fifty lessons in the window.
    Booking.aggregate([
      {
        $match: {
          tutorUserId: matchId,
          status: BOOKING_STATUS.COMPLETED,
          completedAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          netCents: { $sum: "$price.tutorEarningsCents" },
          lessons: { $sum: 1 },
          pendingCents: {
            $sum: {
              $cond: [{ $ifNull: ["$payoutId", false] }, 0, "$price.tutorEarningsCents"],
            },
          },
        },
      },
    ]),
    Booking.find({ tutorUserId, status: BOOKING_STATUS.COMPLETED, completedAt: { $gte: since } })
      .select("reference courseName courseCode startAt price payoutId completedAt")
      .sort({ completedAt: -1 })
      .limit(50)
      .lean(),
    PayoutAccount.findOne({ tutorUserId }).lean(),
  ]);

  const lifetime = totals[0] ?? {
    grossCents: 0,
    commissionCents: 0,
    netCents: 0,
    lessons: 0,
  };

  const periodTotals = period[0] ?? { netCents: 0, lessons: 0, pendingCents: 0 };

  return {
    lifetime: {
      grossCents: lifetime.grossCents,
      commissionCents: lifetime.commissionCents,
      netCents: lifetime.netCents,
      lessons: lifetime.lessons,
    },
    period: {
      days,
      netCents: periodTotals.netCents,
      lessons: periodTotals.lessons,
    },
    pendingPayoutCents: periodTotals.pendingCents,
    /** The most recent lessons, for the table. Never the basis of a total. */
    recentLessons: toPlain(recent),
    payoutAccount: account ? toPlain(account) : null,
  };
}
