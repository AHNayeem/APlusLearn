import "server-only";
import { Types } from "mongoose";
import { Payment, Booking, PayoutAccount } from "@/models";
import {
  PAYMENT_STATUS,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, AuthorizationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { formatMoney } from "@/lib/utils/format";
import { getPaymentProvider } from "./external/payment-provider";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

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

  const provider = getPaymentProvider();
  const checkout = await provider.createCheckout({
    bookingReference: bookings[0].reference,
    amountCents: totals.totalCents,
    metadata: { bookingIds: bookings.map((b) => String(b._id)).join(",") },
  });

  // One Payment row covers a whole series; `bookingId` points at the first.
  const payment = await Payment.create({
    bookingId: bookings[0]._id,
    purchaserId,
    tutorUserId,
    ...totals,
    commissionPercent: bookings[0].price.commissionPercent,
    status: PAYMENT_STATUS.REQUIRES_PAYMENT,
    provider: provider.name,
    providerCheckoutId: checkout.checkoutId,
    providerPaymentIntentId: checkout.paymentIntentId,
  });

  return { ...toPlain(payment), checkoutUrl: checkout.checkoutUrl };
}

/**
 * Complete checkout. The card details go straight to the provider and are
 * never persisted — only the brand and last four digits come back (§35).
 */
export async function capturePayment(paymentId, { card }, actor) {
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

  const result = await getPaymentProvider().capturePayment({
    paymentIntentId: payment.providerPaymentIntentId,
    card,
  });

  if (result.status !== "PAID") {
    payment.status = PAYMENT_STATUS.FAILED;
    payment.failureReason = result.failureReason;
    await payment.save();
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

  const result = await getPaymentProvider().processRefund({
    paymentIntentId: payment.providerPaymentIntentId,
    amountCents,
    reason,
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

  await notify({
    userId: payment.purchaserId,
    type: NOTIFICATION_TYPES.REFUND_ISSUED,
    title: `${formatMoney(amountCents)} refunded`,
    body: reason,
    href: "/payments",
    entityType: "Payment",
    entityId: payment._id,
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

  const [totals, recent, account] = await Promise.all([
    Booking.aggregate([
      {
        $match: {
          tutorUserId:
            typeof tutorUserId === "string" ? new Types.ObjectId(tutorUserId) : tutorUserId,
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

  const periodNet = recent.reduce((sum, b) => sum + b.price.tutorEarningsCents, 0);
  const unpaid = recent.filter((b) => !b.payoutId);

  return {
    lifetime: {
      grossCents: lifetime.grossCents,
      commissionCents: lifetime.commissionCents,
      netCents: lifetime.netCents,
      lessons: lifetime.lessons,
    },
    period: {
      days,
      netCents: periodNet,
      lessons: recent.length,
    },
    pendingPayoutCents: unpaid.reduce((sum, b) => sum + b.price.tutorEarningsCents, 0),
    recentLessons: toPlain(recent),
    payoutAccount: account ? toPlain(account) : null,
  };
}
