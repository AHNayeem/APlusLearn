import "server-only";
import { Types } from "mongoose";
import { Payment, Booking, PayoutAccount, User, CreditEntry } from "@/models";
import {
  PAYMENT_STATUS,
  BOOKING_STATUS,
  BLOCKING_BOOKING_STATUSES,
  CREDIT_REASONS,
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
import { netTutorEarnings, netTutorEarningsExpression } from "@/lib/booking/pricing";
import {
  holdMinutes,
  SETTLED_PAYMENT_STATUSES,
  POLICY,
  earningBookingMatch,
} from "@/lib/booking/policy";
import { getPaymentProvider } from "./external/payment-provider";
import { getSettings } from "./settings.service";
import { spendCredit, releaseCredit, grantCredit } from "./credit.service";
import { recordBookingRefund, tutorPayoutPosition } from "./payout.service";
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

  // One line per session, so a payment that never confirms can be traced from
  // here to the provider's dashboard and to the webhook that should have
  // settled it (§38). Identifiers and amounts only — a credential, a card
  // number or a customer's email would make the log the leak.
  console.info(
    "[payment] checkout.session.created " +
      JSON.stringify({
        paymentId: String(payment._id),
        provider: checkout.provider,
        checkoutId: checkout.checkoutId,
        paymentIntentId: checkout.paymentIntentId ?? null,
        amountCents: checkout.amountCents,
        currency: checkout.currency,
        livemode: Boolean(checkout.livemode),
        expiresAt: checkout.expiresAt ?? null,
      }),
  );

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
 * Refuse, before anything is read, when card details are not ours to take.
 *
 * Under a hosted provider the card is entered on the provider's own page, so
 * the in-app capture endpoint does not exist at all (S16). It answers 404 —
 * not "you sent the wrong thing" — and it is called *before* the request
 * body is parsed, so a card number posted to it is never read.
 */
export async function requireInAppCheckout() {
  const provider = await getPaymentProvider();
  if (provider.hostedCheckout) {
    throw new NotFoundError("There is nothing to submit here. Continue to checkout to complete this payment.");
  }
  return provider;
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

  // A lesson payment whose bookings were all cancelled before it was paid has
  // nothing left to pay for (R27.2). Refused before the card is charged —
  // the late-payment refund below is for the provider that cannot be stopped,
  // not a licence to take money and give it back.
  if (payment.bookingId) {
    const payable = await Booking.exists({
      paymentId: payment._id,
      status: { $in: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED] },
    });
    if (!payable) {
      throw new BusinessRuleError(
        "This booking was cancelled, so there is nothing to pay.",
        "PAYMENT_VOID",
      );
    }
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

  // Part of a series may have been cancelled while the rest was still unpaid.
  await refundCancelledBeforePayment(payment);

  return toPlain(await Payment.findById(payment._id).lean());
}

/**
 * Send cash back to the card a payment was taken from (§20, R16.7).
 *
 * The ledger is the guard: never more than was collected and not yet
 * returned. Every refund is also attributed to the lesson(s) it was for —
 * `bookingAllocations` when the caller knows (a cancellation, a dispute), or
 * spread across the payment's lessons by what each still has unrefunded when
 * it does not (an administrator refunding a payment). That attribution is
 * `Booking.refundedCents`, which every payout nets against (S3, R16.4); a
 * refund on a lesson already paid out becomes a deduction on the tutor's next
 * payout instead of vanishing. A package payment is not attributed to its
 * lessons unless the caller names one — the refund is for the package.
 *
 * @param {string} paymentId
 * @param {object} args
 * @param {number} args.amountCents
 * @param {string} args.reason
 * @param {string} [args.issuedBy]
 * @param {{ bookingId: string, cents: number }[]} [args.bookingAllocations]
 */
export async function refundPayment(paymentId, { amountCents, reason, issuedBy, bookingAllocations }) {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new BusinessRuleError("Enter a refund amount.", "INVALID_REFUND_AMOUNT");
  }

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

  await attributeRefund(payment, amountCents, { bookingAllocations, reason, issuedBy });

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
 * Put a refund against the lesson(s) it was for. Runs after the money has
 * moved, so it never throws: a refund that reached the card is not undone
 * because its bookkeeping hiccupped — it is logged loudly instead.
 */
async function attributeRefund(payment, amountCents, { bookingAllocations, reason, issuedBy }) {
  try {
    let allocations = bookingAllocations;
    if (!allocations) {
      if (!payment.bookingId) return;
      const lessons = await Booking.find({ paymentId: payment._id })
        .select("price refundedCents")
        .sort({ startAt: 1 })
        .lean();
      if (!lessons.length) return;
      const open = lessons.map((b) => Math.max(0, (b.price?.totalCents ?? 0) - (b.refundedCents ?? 0)));
      const weights = open.some((w) => w > 0) ? open : lessons.map((b) => b.price?.totalCents ?? 1);
      const split = splitProportionally(amountCents, weights);
      allocations = lessons.map((b, i) => ({ bookingId: b._id, cents: split[i] }));
    }

    for (const { bookingId, cents } of allocations) {
      if (cents > 0) {
        await recordBookingRefund(bookingId, cents, {
          reason,
          actor: issuedBy ? { id: issuedBy } : undefined,
        });
      }
    }
  } catch (error) {
    console.error(
      `[payment] refund of ${amountCents} on ${payment._id} was issued but could not be attributed to its lessons:`,
      error,
    );
  }
}

/**
 * Split `total` across `weights` in whole cents, largest remainders first, so
 * the parts always add back up to exactly `total`.
 */
export function splitProportionally(total, weights) {
  const sum = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * Math.max(0, w)) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left -= 1) parts[order[i].index] += 1;
  return parts;
}

/** Credit already given back as the credit share of earlier refunds. */
async function creditRecreditedOn(paymentId) {
  const [row] = await CreditEntry.aggregate([
    { $match: { paymentId, reason: CREDIT_REASONS.REFUND_RECREDITED } },
    { $group: { _id: null, cents: { $sum: "$amountCents" } } },
  ]);
  return row?.cents ?? 0;
}

/**
 * How a refund measured in *lesson value* comes back, worked out before
 * anything moves (R16.7).
 *
 * A lesson's value can have been paid partly in cash and partly in account
 * credit. The policy decides a percentage of the value; this splits it the
 * same way the purchase was split — the cash share back to the card, never
 * more than the card was charged and not yet refunded, and the credit share
 * back to the account it came from, never more than was applied and not yet
 * returned. If one side has run out, the other covers what it can. A payment
 * that never settled returns nothing here: there is no money to send back,
 * and its credit is returned whole by `returnAppliedCredit` instead.
 *
 * Pure apart from one read of the credit ledger, and called before any
 * booking is touched — so a refund that cannot happen is known while there
 * is still nothing to undo.
 */
export async function planLessonRefund(payment, valueCents) {
  const settled = SETTLED_PAYMENT_STATUSES.includes(payment.status);
  const cashRemaining = settled ? Math.max(0, payment.totalCents - (payment.refundedCents ?? 0)) : 0;
  const creditApplied = payment.creditAppliedCents ?? 0;
  const creditRecreditedCents = creditApplied > 0 ? await creditRecreditedOn(payment._id) : 0;
  const creditRemaining =
    settled && !payment.creditReleasedAt ? Math.max(0, creditApplied - creditRecreditedCents) : 0;

  const value = Math.max(0, Math.round(valueCents ?? 0));
  const lessonValue = (payment.totalCents ?? 0) + creditApplied;
  const cashShare = lessonValue > 0 ? Math.round((value * payment.totalCents) / lessonValue) : 0;

  let cashCents = Math.min(cashShare, cashRemaining);
  const creditCents = Math.min(value - cashCents, creditRemaining);
  if (cashCents + creditCents < value) cashCents = Math.min(value - creditCents, cashRemaining);

  return {
    valueCents: value,
    cashCents,
    creditCents,
    refundedCents: cashCents + creditCents,
    cashRemaining,
    creditRemaining,
    creditRecreditedCents,
  };
}

/**
 * What can still be given back on one lesson, in lesson value: the lesson's
 * own unrefunded value, bounded by what its payment can actually return.
 *
 * @param {object} booking
 * @param {object} [options]
 * @param {number} [options.alreadyRefundedCents]  Overrides `booking.refundedCents`
 *   for records refunded before that field was kept.
 */
export async function refundableOnBooking(booking, { alreadyRefundedCents } = {}) {
  if (!booking.paymentId) return 0;
  const payment = await Payment.findById(booking.paymentId._id ?? booking.paymentId).lean();
  if (!payment) return 0;
  const refunded = alreadyRefundedCents ?? booking.refundedCents ?? 0;
  const open = Math.max(0, (booking.price?.totalCents ?? 0) - refunded);
  return (await planLessonRefund(payment, open)).refundedCents;
}

/**
 * Refund an amount of lesson value: the cash share to the card, the credit
 * share back to the account, both attributed to the named lessons (R16.7).
 *
 * @param {string} paymentId
 * @param {object} args
 * @param {{ bookingId: string, valueCents: number }[]} args.allocations
 * @param {string} args.reason
 * @param {string} [args.issuedBy]
 * @returns {Promise<{ cashCents: number, creditCents: number, refundedCents: number, perBooking: object[] }>}
 */
export async function refundLessonValue(paymentId, { allocations, reason, issuedBy }) {
  const payment = await Payment.findById(paymentId).lean();
  if (!payment) throw new NotFoundError("That payment no longer exists.");

  const weights = allocations.map((a) => Math.max(0, a.valueCents ?? 0));
  const valueCents = weights.reduce((a, b) => a + b, 0);
  const plan = await planLessonRefund(payment, valueCents);

  const cashSplit = splitProportionally(plan.cashCents, weights);
  const creditSplit = splitProportionally(plan.creditCents, weights);

  if (plan.cashCents > 0) {
    await refundPayment(paymentId, {
      amountCents: plan.cashCents,
      reason,
      issuedBy,
      bookingAllocations: allocations.map((a, i) => ({ bookingId: a.bookingId, cents: cashSplit[i] })),
    });
  }

  if (plan.creditCents > 0) {
    await grantCredit({
      userId: payment.purchaserId,
      amountCents: plan.creditCents,
      reason: CREDIT_REASONS.REFUND_RECREDITED,
      paymentId: payment._id,
      bookingId: allocations[0]?.bookingId,
      note: reason,
      createdBy: issuedBy,
      // Keyed on what had already been re-credited, so a retried call adds
      // nothing and a later, separate refund still can.
      idempotencyKey: `refund-credit:${payment._id}:${plan.creditRecreditedCents}:${plan.creditCents}`,
    });
    for (const [i, allocation] of allocations.entries()) {
      if (creditSplit[i] > 0) {
        await recordBookingRefund(allocation.bookingId, creditSplit[i], {
          reason,
          actor: issuedBy ? { id: issuedBy } : undefined,
        }).catch((error) => console.error("[payment] credit refund attribution failed:", error));
      }
    }
  }

  return {
    ...plan,
    perBooking: allocations.map((a, i) => ({
      bookingId: String(a.bookingId),
      cashCents: cashSplit[i],
      creditCents: creditSplit[i],
      refundedCents: cashSplit[i] + creditSplit[i],
    })),
  };
}

/**
 * Stop an unpaid payment being payable once nothing it covers is still
 * booked (R27.2).
 *
 * The checkout is expired at the provider where the provider can do that, so
 * the purchaser's payment page stops working rather than taking money for a
 * cancelled lesson; the payment is marked failed with the reason; and any
 * credit that was applied to it goes back. A provider that cannot expire a
 * session is not a failure here — `markPaymentPaid` refunds a payment that
 * arrives for cancelled lessons anyway.
 *
 * @returns {Promise<{ voided: boolean, reason?: string, checkoutExpired?: boolean }>}
 */
export async function voidUnpaidPayment(paymentId, { reason } = {}) {
  const stillHeld = await Booking.exists({
    paymentId,
    status: { $in: BLOCKING_BOOKING_STATUSES },
  });
  if (stillHeld) return { voided: false, reason: "STILL_HELD" };

  const payment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      status: { $in: [PAYMENT_STATUS.REQUIRES_PAYMENT, PAYMENT_STATUS.PROCESSING, PAYMENT_STATUS.FAILED] },
    },
    {
      $set: {
        status: PAYMENT_STATUS.FAILED,
        failureReason: reason ?? "The booking was cancelled before it was paid for.",
      },
      $unset: { providerCheckoutUrl: "", checkoutExpiresAt: "" },
    },
    { returnDocument: "before" },
  ).lean();
  if (!payment) return { voided: false, reason: "SETTLED" };

  let checkoutExpired = false;
  if (payment.providerCheckoutId) {
    try {
      const provider = await getPaymentProvider();
      if (provider.name === payment.provider) {
        const result = await provider.expireCheckout({ checkoutId: payment.providerCheckoutId });
        checkoutExpired = Boolean(result?.expired);
      }
    } catch (error) {
      console.warn(`[payment] checkout ${payment.providerCheckoutId} could not be expired:`, error.message);
    }
  }

  await returnAppliedCredit(
    { ...payment, status: PAYMENT_STATUS.FAILED },
    "Returned from a booking that was cancelled before payment.",
  ).catch((error) => console.warn("[payment] credit return failed:", error.message));

  return { voided: true, checkoutExpired };
}

/**
 * Money that arrived for lessons cancelled before they were paid for goes
 * straight back (R27.2).
 *
 * A hosted checkout cannot always be stopped in time — a session expiry can
 * race the purchaser's last click, and an async payment method settles days
 * later — so the settlement path checks, rather than charging for nothing.
 * Never throws: it runs inside the settlement of a payment the provider has
 * already taken, and a refund it cannot make is recorded for an
 * administrator rather than failing the settlement.
 */
async function refundCancelledBeforePayment(payment) {
  if (!payment?.bookingId) return null;
  const cancelled = await Booking.find({
    paymentId: payment._id,
    "cancellation.policyApplied": POLICY.UNPAID_CANCELLATION,
  })
    .select("price refundedCents")
    .lean();
  const owed = cancelled.filter((b) => (b.refundedCents ?? 0) < (b.price?.totalCents ?? 0));
  if (!owed.length) return null;

  try {
    return await refundLessonValue(payment._id, {
      allocations: owed.map((b) => ({
        bookingId: b._id,
        valueCents: (b.price?.totalCents ?? 0) - (b.refundedCents ?? 0),
      })),
      reason: "Paid after the lesson was cancelled — refunded in full.",
    });
  } catch (error) {
    console.error(`[payment] ${payment._id} was paid after cancellation and could not be refunded:`, error);
    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.REFUND_ISSUED,
      entityType: "Payment",
      entityId: payment._id,
      metadata: { needsRefund: true, reason: "paid after cancellation", error: error.message },
    }).catch(() => {});
    return null;
  }
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

  // Already settled. REFUNDED and PARTIALLY_REFUNDED belong here with PAID:
  // the money arrived and has since been sent back, and a late duplicate of
  // the event that settled it must not walk that refund off the record.
  if (SETTLED_PAYMENT_STATUSES.includes(payment.status)) {
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

  // The claim, not the check above, is what makes this safe to run twice at
  // once. Two authorities can settle the same payment — the provider's
  // webhook and the reconciliation the purchaser's own return page triggers
  // — and they routinely arrive within the same second. A read-then-save
  // would let both see REQUIRES_PAYMENT and both go on to `confirmBookings`,
  // which would build two meeting rooms and send two confirmation emails.
  // A conditional update makes exactly one of them the one that changed it.
  const claimed = await Payment.findOneAndUpdate(
    { _id: paymentId, status: { $nin: SETTLED_PAYMENT_STATUSES } },
    {
      $set: {
        status: PAYMENT_STATUS.PAID,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        receiptNumber:
          receiptNumber ?? payment.receiptNumber ?? `RCPT-${String(payment._id).slice(-8).toUpperCase()}`,
        ...(paymentMethodBrand ? { paymentMethodBrand } : {}),
        ...(paymentMethodLast4 ? { paymentMethodLast4 } : {}),
        ...(chargeId ? { providerChargeId: chargeId } : {}),
        ...(paymentIntentId ? { providerPaymentIntentId: paymentIntentId } : {}),
      },
      $unset: { failureReason: "" },
    },
    { returnDocument: "after" },
  );

  // Somebody else settled it between the read and the claim.
  if (!claimed) {
    return { changed: false, payment: toPlain(await Payment.findById(paymentId).lean()) };
  }

  // Money for lessons that were cancelled while unpaid goes straight back
  // (R27.2). Only the claimant runs this, so it happens once.
  const lateRefund = await refundCancelledBeforePayment(claimed);
  if (lateRefund) {
    return { changed: true, payment: toPlain(await Payment.findById(paymentId).lean()), lateRefund };
  }

  return { changed: true, payment: toPlain(claimed) };
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
  // A refunded one is settled too — its credit share went back with the
  // refund (`refundLessonValue`), and returning it whole here would pay it
  // twice.
  if (SETTLED_PAYMENT_STATUSES.includes(payment.status)) {
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

  // Made outside the app, so nobody named the lesson: spread it across the
  // payment's lessons like an administrator's refund (S3, R16.4).
  await attributeRefund(payment, amountCents, { reason: reason ?? "Refunded at the payment provider" });

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
/**
 * Totals over every payment matching the admin filter (R28.16) — summed in
 * MongoDB across the whole set, never from the page on screen. Collected
 * money is settled payments only; commission is net of refunds, pro rata.
 */
export async function paymentTotals({ status, purchaserId } = {}) {
  const match = status ? { status } : {};
  if (purchaserId) match.purchaserId = new Types.ObjectId(String(purchaserId));
  const [row] = await Payment.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        collected: {
          $sum: { $cond: [{ $in: ["$status", SETTLED_PAYMENT_STATUSES] }, "$totalCents", 0] },
        },
        refunded: { $sum: { $ifNull: ["$refundedCents", 0] } },
        commission: {
          $sum: {
            $cond: [
              { $and: [{ $in: ["$status", SETTLED_PAYMENT_STATUSES] }, { $gt: ["$totalCents", 0] }] },
              {
                $multiply: [
                  "$commissionCents",
                  { $subtract: [1, { $divide: [{ $ifNull: ["$refundedCents", 0] }, "$totalCents"] }] },
                ],
              },
              0,
            ],
          },
        },
      },
    },
  ]);
  return {
    count: row?.count ?? 0,
    collectedCents: row?.collected ?? 0,
    refundedCents: row?.refunded ?? 0,
    commissionCents: Math.round(row?.commission ?? 0),
  };
}

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

  // The lessons a tutor is paid for — completed, a student no-show, a late
  // cancellation — by the one rule payouts use, and every figure net of what
  // was refunded on the lesson (R16.9, R23.7).
  const earning = { tutorUserId: matchId, ...earningBookingMatch() };
  const net = netTutorEarningsExpression();
  const kept = {
    $max: [0, { $subtract: ["$price.subtotalCents", { $ifNull: ["$refundedCents", 0] }] }],
  };

  const [totals, period, recent, account, position] = await Promise.all([
    Booking.aggregate([
      { $match: earning },
      {
        $group: {
          _id: null,
          grossCents: { $sum: kept },
          netCents: { $sum: net },
          lessons: { $sum: 1 },
        },
      },
    ]),
    // Aggregated rather than reduced from `recent` below: that list is capped
    // at 50 rows, so a busy tutor's period total used to stop counting once
    // they passed fifty lessons in the window.
    Booking.aggregate([
      { $match: { ...earning, $expr: { $gte: [{ $ifNull: ["$completedAt", "$cancellation.cancelledAt"] }, since] } } },
      { $group: { _id: null, netCents: { $sum: net }, lessons: { $sum: 1 } } },
    ]),
    Booking.find({ ...earning, completedAt: { $gte: since } })
      .select("reference courseName courseCode startAt price refundedCents payoutId completedAt status")
      .sort({ completedAt: -1 })
      .limit(50)
      .lean(),
    PayoutAccount.findOne({ tutorUserId }).lean(),
    // Owed is owed whenever it was earned: never limited to the period shown.
    tutorPayoutPosition(tutorUserId),
  ]);

  const lifetime = totals[0] ?? { grossCents: 0, netCents: 0, lessons: 0 };
  const periodTotals = period[0] ?? { netCents: 0, lessons: 0 };

  return {
    lifetime: {
      grossCents: lifetime.grossCents,
      commissionCents: Math.max(0, lifetime.grossCents - lifetime.netCents),
      netCents: lifetime.netCents,
      lessons: lifetime.lessons,
    },
    period: {
      days,
      netCents: periodTotals.netCents,
      lessons: periodTotals.lessons,
    },
    pendingPayoutCents: position?.pendingCents ?? 0,
    /** The most recent lessons, for the table. Never the basis of a total. */
    recentLessons: toPlain(recent).map((lesson) => ({
      ...lesson,
      netEarningsCents: netTutorEarnings(lesson.price, lesson.refundedCents),
    })),
    payoutAccount: account ? toPlain(account) : null,
  };
}
