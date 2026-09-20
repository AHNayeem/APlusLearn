import "server-only";
import { Types } from "mongoose";
import { Payout, PayoutAccount, Booking, User, TutorProfile } from "@/models";
import {
  PAYOUT_STATUS,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, AuthorizationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { formatMoney } from "@/lib/utils/format";
import { getPaymentProvider } from "./external/payment-provider";
import { brandedEmailTemplates } from "./external/email-provider";
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

  const provider = await getPaymentProvider();
  const existing = await PayoutAccount.findOne({ tutorUserId });

  if (existing?.onboardingStatus === "COMPLETE" && existing.payoutsEnabled) {
    return toPlain(existing);
  }

  // Passing the existing account id is what makes "continue where I left off"
  // work: the provider returns a fresh link onto the same account rather than
  // opening a second one.
  const result = await provider.createConnectedAccount({
    email: user.email,
    accountId: existing?.provider === provider.name ? existing.providerAccountId : undefined,
    returnUrl: payoutUrl("?onboarding=complete"),
    refreshUrl: payoutUrl("?onboarding=refresh"),
    metadata: { tutorUserId: String(tutorUserId) },
  });

  const account = await PayoutAccount.findOneAndUpdate(
    { tutorUserId },
    {
      $set: {
        provider: provider.name,
        providerAccountId: result.accountId,
        onboardingStatus: result.onboardingStatus,
        payoutsEnabled: result.payoutsEnabled,
        chargesEnabled: result.chargesEnabled,
        detailsSubmitted: result.detailsSubmitted ?? false,
        requirementsDue: result.requirementsDue,
        disabledReason: result.disabledReason ?? undefined,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).lean();

  return { ...toPlain(account), onboardingUrl: result.onboardingUrl };
}

function payoutUrl(suffix = "") {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/tutor/payouts${suffix}`;
}

/**
 * Re-read the payout account's real state from the provider (§20).
 *
 * The tutor returning from hosted onboarding triggers this, and so does the
 * provider's own `account.updated` webhook. It never *declares* an account
 * complete — only the provider decides whether identity and banking checks
 * have passed, and this records whatever they say.
 */
export async function refreshPayoutAccount(tutorUserId) {
  const account = await PayoutAccount.findOne({ tutorUserId });
  if (!account) throw new NotFoundError("Start payout setup first.");

  const result = await (await getPaymentProvider()).refreshConnectedAccount({
    accountId: account.providerAccountId,
  });

  return applyAccountState(account, result);
}

/** Apply provider-reported account state and notify on the transitions. */
export async function applyAccountState(account, result) {
  const wasEnabled = account.payoutsEnabled;

  Object.assign(account, {
    onboardingStatus: result.onboardingStatus,
    payoutsEnabled: result.payoutsEnabled,
    chargesEnabled: result.chargesEnabled,
    detailsSubmitted: result.detailsSubmitted ?? account.detailsSubmitted,
    bankName: result.bankName ?? account.bankName,
    accountLast4: result.accountLast4 ?? account.accountLast4,
    requirementsDue: result.requirementsDue ?? [],
    disabledReason: result.disabledReason ?? undefined,
  });
  if (result.payoutsEnabled && !account.completedAt) account.completedAt = new Date();
  await account.save();

  const tutor = await User.findById(account.tutorUserId).select("firstName").lean();

  if (result.payoutsEnabled && !wasEnabled) {
    await notify({
      userId: account.tutorUserId,
      type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
      title: "Payouts are enabled",
      body: "Your earnings will now be paid out automatically after each lesson's hold period.",
      href: "/tutor/payouts",
      channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
      email: (await brandedEmailTemplates()).payoutsEnabled({ firstName: tutor?.firstName ?? "there" }),
    });
  } else if (!result.payoutsEnabled && wasEnabled) {
    // Payouts were switched off — the tutor needs to know why, and that their
    // money is being held rather than lost.
    await notify({
      userId: account.tutorUserId,
      type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
      title: "Payouts are paused",
      body:
        result.requirementsDue?.length
          ? `Our payments partner needs: ${result.requirementsDue.join(", ")}.`
          : "Our payments partner needs more information before your next payout.",
      href: "/tutor/payouts",
      channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
      email: (await brandedEmailTemplates()).payoutOnboardingRequired({
        firstName: tutor?.firstName ?? "there",
        requirements: result.requirementsDue ?? [],
      }),
    });
  }

  return toPlain(account);
}

/** Look a payout account up by the provider's own identifier, for webhooks. */
export async function payoutAccountByProviderId(providerAccountId) {
  return PayoutAccount.findOne({ providerAccountId });
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

    if (!account?.payoutsEnabled) {
      throw new BusinessRuleError(
        "This tutor's payout account is not enabled, so money cannot be sent yet.",
        "PAYOUT_ACCOUNT_INCOMPLETE",
      );
    }
    // Already sent: re-marking a payout paid must never move money twice.
    if (payout.providerTransferId) {
      return toPlain(payout);
    }

    const transfer = await (await getPaymentProvider()).createTransfer({
      accountId: account.providerAccountId,
      amountCents: payout.amountCents,
      currency: payout.currency,
      metadata: { payoutReference: payout.reference, tutorUserId: String(payout.tutorUserId) },
      // The payout reference is stable, so a retried "mark as paid" is
      // recognised by the provider instead of sending a second transfer.
      idempotencyKey: `transfer-${payout.reference}`,
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

  const tutor = await User.findById(payout.tutorUserId).select("firstName").lean();
  const paid = status === PAYOUT_STATUS.PAID;

  await notify({
    userId: payout.tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title: paid
      ? `${formatMoney(payout.amountCents)} is on its way`
      : `Payout ${payout.reference} is now ${status.toLowerCase().replace("_", " ")}`,
    body: note,
    href: "/tutor/payouts",
    entityType: "Payout",
    entityId: payout._id,
    channels: paid
      ? [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL]
      : [NOTIFICATION_CHANNELS.IN_APP],
    email: paid
      ? (await brandedEmailTemplates()).payoutSent({
          firstName: tutor?.firstName ?? "there",
          amountLabel: formatMoney(payout.amountCents),
          lessonCountLabel: `${payout.lessonCount} completed lesson${payout.lessonCount === 1 ? "" : "s"}`,
          reference: payout.reference,
        })
      : undefined,
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

/**
 * Create every payout that is due, for every tutor who can receive one (§20).
 *
 * This is the scheduled counterpart to an administrator pressing the button,
 * and it deliberately reuses `createPayout` rather than reimplementing
 * eligibility: hold period, unclaimed-booking check and the double-pay claim
 * are all defined once. Repeat runs are harmless — `createPayout` stamps
 * `payoutId` onto the bookings it settles, so a second run finds nothing
 * payable and skips the tutor.
 *
 * @param {object} [options]
 * @param {object} [options.actor]  Who to attribute the audit entry to.
 */
export async function runScheduledPayouts({ actor } = {}) {
  const settings = await getSettings();
  if (settings.autoPayouts === false) {
    return { skipped: "AUTO_PAYOUTS_DISABLED", created: 0, amountCents: 0, tutors: 0 };
  }

  const pending = await pendingPayoutSummary();
  const eligible = pending.filter((row) => row.payoutsEnabled);

  const system = actor ?? { id: null, role: ROLES.ADMIN };
  let created = 0;
  let amountCents = 0;
  const failures = [];

  for (const row of eligible) {
    try {
      const payout = await createPayout(row.tutorUserId, system);
      created += 1;
      amountCents += payout.amountCents ?? 0;
    } catch (error) {
      // One tutor's payout failing — an account that lost its provider state
      // between the summary and the write — must not stop the rest of the run.
      failures.push({ tutorUserId: row.tutorUserId, reason: error.code ?? error.message });
    }
  }

  return {
    tutors: eligible.length,
    awaitingPayoutSetup: pending.length - eligible.length,
    created,
    amountCents,
    failures,
  };
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
