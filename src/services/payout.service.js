import "server-only";
import { Types } from "mongoose";
import { Payout, PayoutAccount, Booking, User, TutorProfile } from "@/models";
import {
  PAYOUT_STATUS,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, AuthorizationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { formatMoney } from "@/lib/utils/format";
import { getPaymentProvider } from "./external/payment-provider";
import { getSettings } from "./settings.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Tutor payouts (§20).
 *
 * Eligibility follows booking and payment state: only COMPLETED lessons whose
 * hold period has elapsed and that are not already attached to a payout can
 * be settled (§42).
 */

export async function getPayoutAccount(tutorUserId) {
  const account = await PayoutAccount.findOne({ tutorUserId }).lean();
  return account ? toPlain(account) : null;
}

export async function startPayoutOnboarding(tutorUserId) {
  const user = await User.findById(tutorUserId).select("email").lean();
  if (!user) throw new NotFoundError("We couldn't find your account.");

  const provider = getPaymentProvider();
  const existing = await PayoutAccount.findOne({ tutorUserId });

  if (existing?.onboardingStatus === "COMPLETE") {
    return toPlain(existing);
  }

  const result = await provider.createConnectedAccount({ email: user.email });

  const account = await PayoutAccount.findOneAndUpdate(
    { tutorUserId },
    {
      $set: {
        provider: provider.name,
        providerAccountId: result.accountId,
        onboardingStatus: result.onboardingStatus,
        payoutsEnabled: result.payoutsEnabled,
        chargesEnabled: result.chargesEnabled,
        requirementsDue: result.requirementsDue,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).lean();

  return { ...toPlain(account), onboardingUrl: result.onboardingUrl };
}

/** Finish onboarding. A real provider drives this through a webhook. */
export async function completePayoutOnboarding(tutorUserId) {
  const account = await PayoutAccount.findOne({ tutorUserId });
  if (!account) throw new NotFoundError("Start payout setup first.");

  const result = await getPaymentProvider().completeConnectedAccount({
    accountId: account.providerAccountId,
  });

  Object.assign(account, {
    onboardingStatus: result.onboardingStatus,
    payoutsEnabled: result.payoutsEnabled,
    chargesEnabled: result.chargesEnabled,
    bankName: result.bankName,
    accountLast4: result.accountLast4,
    requirementsDue: result.requirementsDue,
    completedAt: new Date(),
  });
  await account.save();

  await notify({
    userId: tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title: "Payouts are enabled",
    body: "Your earnings will now be paid out automatically after each lesson's hold period.",
    href: "/tutor/payouts",
  });

  return toPlain(account);
}

/** Lessons ready to be paid out to a tutor. */
export async function payableBookings(tutorUserId, settings) {
  const holdCutoff = new Date(Date.now() - settings.payoutHoldDays * 86400000);
  return Booking.find({
    tutorUserId,
    status: BOOKING_STATUS.COMPLETED,
    completedAt: { $lte: holdCutoff },
    payoutId: { $exists: false },
  })
    .select("price completedAt reference")
    .lean();
}

/**
 * Build a payout for one tutor. Called by an admin, or by a scheduled job in
 * production — the logic is the same either way.
 */
export async function createPayout(tutorUserId, actor) {
  const settings = await getSettings();
  const account = await PayoutAccount.findOne({ tutorUserId }).lean();

  if (!account?.payoutsEnabled) {
    throw new BusinessRuleError(
      "This tutor has not finished payout setup yet.",
      "PAYOUT_ACCOUNT_INCOMPLETE",
    );
  }

  const bookings = await payableBookings(tutorUserId, settings);
  if (!bookings.length) {
    throw new BusinessRuleError(
      `No lessons are ready for payout. Earnings become payable ${settings.payoutHoldDays} days after a lesson is completed.`,
      "NOTHING_PAYABLE",
    );
  }

  const totals = bookings.reduce(
    (acc, b) => ({
      grossCents: acc.grossCents + b.price.subtotalCents,
      commissionCents: acc.commissionCents + b.price.commissionCents,
      amountCents: acc.amountCents + b.price.tutorEarningsCents,
    }),
    { grossCents: 0, commissionCents: 0, amountCents: 0 },
  );

  const profile = await TutorProfile.findOne({ userId: tutorUserId }).select("_id").lean();

  const payout = await Payout.create({
    reference: publicReference("PAY"),
    tutorUserId,
    tutorProfileId: profile?._id,
    bookingIds: bookings.map((b) => b._id),
    lessonCount: bookings.length,
    ...totals,
    status: PAYOUT_STATUS.PENDING,
    periodStart: bookings.reduce((min, b) => (b.completedAt < min ? b.completedAt : min), bookings[0].completedAt),
    periodEnd: bookings.reduce((max, b) => (b.completedAt > max ? b.completedAt : max), bookings[0].completedAt),
  });

  // Claim the bookings so a concurrent run cannot pay them twice.
  await Booking.updateMany(
    { _id: { $in: bookings.map((b) => b._id) } },
    { $set: { payoutId: payout._id } },
  );

  await notify({
    userId: tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title: `Payout of ${formatMoney(totals.amountCents)} created`,
    body: `Covering ${bookings.length} completed lesson${bookings.length === 1 ? "" : "s"}.`,
    href: "/tutor/payouts",
    entityType: "Payout",
    entityId: payout._id,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PAYOUT_MARKED_PAID,
    entityType: "Payout",
    entityId: payout._id,
    metadata: { created: true, amountCents: totals.amountCents },
  });

  return toPlain(payout);
}

export async function updatePayoutStatus(payoutId, { status, note, scheduledFor }, actor) {
  const payout = await Payout.findById(payoutId);
  if (!payout) throw new NotFoundError("That payout no longer exists.");

  if (status === PAYOUT_STATUS.PAID) {
    const account = await PayoutAccount.findOne({ tutorUserId: payout.tutorUserId }).lean();
    const transfer = await getPaymentProvider().createTransfer({
      accountId: account?.providerAccountId,
      amountCents: payout.amountCents,
    });
    payout.providerTransferId = transfer.transferId;
    payout.paidAt = new Date();
  }

  if (status === PAYOUT_STATUS.FAILED) {
    payout.failureReason = note;
    // Release the lessons so they can be retried on the next run.
    await Booking.updateMany({ payoutId: payout._id }, { $unset: { payoutId: "" } });
  }

  payout.status = status;
  payout.processedBy = actor.id;
  if (scheduledFor) payout.scheduledFor = new Date(scheduledFor);
  await payout.save();

  await notify({
    userId: payout.tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title:
      status === PAYOUT_STATUS.PAID
        ? `${formatMoney(payout.amountCents)} is on its way`
        : `Payout ${payout.reference} is now ${status.toLowerCase().replace("_", " ")}`,
    body: note,
    href: "/tutor/payouts",
    entityType: "Payout",
    entityId: payout._id,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PAYOUT_MARKED_PAID,
    entityType: "Payout",
    entityId: payout._id,
    metadata: { status, note },
  });

  return toPlain(payout);
}

export async function listPayouts(actor, { page = 1, pageSize, status, tutorUserId } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};

  if (actor.role === ROLES.TUTOR) query.tutorUserId = actor.id;
  else if (actor.role !== ROLES.ADMIN) throw new AuthorizationError();
  else if (tutorUserId) query.tutorUserId = tutorUserId;

  if (status) query.status = status;

  const [items, total] = await Promise.all([
    Payout.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("tutorUserId", "firstName lastName email")
      .lean(),
    Payout.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

/** Admin view: who is owed money right now. */
export async function pendingPayoutSummary() {
  const settings = await getSettings();
  const holdCutoff = new Date(Date.now() - settings.payoutHoldDays * 86400000);

  const rows = await Booking.aggregate([
    {
      $match: {
        status: BOOKING_STATUS.COMPLETED,
        completedAt: { $lte: holdCutoff },
        payoutId: { $exists: false },
      },
    },
    {
      $group: {
        _id: "$tutorUserId",
        amountCents: { $sum: "$price.tutorEarningsCents" },
        lessonCount: { $sum: 1 },
        oldestCompletedAt: { $min: "$completedAt" },
      },
    },
    { $sort: { amountCents: -1 } },
    { $limit: 100 },
  ]);

  const [users, accounts] = await Promise.all([
    User.find({ _id: { $in: rows.map((r) => r._id) } })
      .select("firstName lastName email")
      .lean(),
    PayoutAccount.find({ tutorUserId: { $in: rows.map((r) => r._id) } }).lean(),
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const accountMap = new Map(accounts.map((a) => [String(a.tutorUserId), a]));

  return rows.map((row) => ({
    tutorUserId: String(row._id),
    tutor: toPlain(userMap.get(String(row._id)) ?? null),
    amountCents: row.amountCents,
    lessonCount: row.lessonCount,
    oldestCompletedAt: row.oldestCompletedAt?.toISOString?.() ?? null,
    payoutsEnabled: accountMap.get(String(row._id))?.payoutsEnabled ?? false,
  }));
}

export { Types };
