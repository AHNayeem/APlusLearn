import "server-only";
import { Types } from "mongoose";
import { Payout, PayoutAccount, PayoutAdjustment, Booking, User, TutorProfile } from "@/models";
import {
  PAYOUT_STATUS,
  PAYOUT_STATUS_LABELS,
  PAYOUT_STATUS_TRANSITIONS,
  PAYOUT_ADJUSTMENT_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import {
  NotFoundError,
  BusinessRuleError,
  AuthorizationError,
  ConflictError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { formatMoney } from "@/lib/utils/format";
import { netTutorEarnings, netTutorEarningsExpression } from "@/lib/booking/pricing";
import { earningBookingMatch, payableBookingMatch } from "@/lib/booking/policy";
import { getPaymentProvider } from "./external/payment-provider";
import { brandedEmailTemplates } from "./external/email-provider";
import { getSettings } from "./settings.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Tutor payouts (§20).
 *
 * Eligibility follows booking and payment state: only earned lessons whose
 * hold period has elapsed and that are not already attached to a payout can
 * be settled (§42), and each pays the tutor's share of what was actually
 * kept after refunds (`netTutorEarnings`, S3/R16.4).
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

// --- What is payable (§20, R16.4) --------------------------------------------

function holdCutoffFor(settings, now = new Date()) {
  return new Date(now.getTime() - settings.payoutHoldDays * 86400000);
}

/** Only lessons that leave the tutor something after refunds are worth a line. */
const HAS_NET_EARNINGS = { $expr: { $gt: [netTutorEarningsExpression(), 0] } };

/**
 * Lessons ready to be paid out to a tutor: earned (`payableBookingMatch` in
 * lib/booking/policy), past the hold, unclaimed, and still worth something
 * once their refunds are netted off.
 */
export async function payableBookings(tutorUserId, settings, now = new Date()) {
  return Booking.find({
    tutorUserId,
    payoutId: { $exists: false },
    ...payableBookingMatch(holdCutoffFor(settings, now)),
    ...HAS_NET_EARNINGS,
  })
    .select("price refundedCents completedAt cancellation reference")
    .sort({ completedAt: 1 })
    .lean();
}

/** When a payable lesson became payable, whichever way it was earned. */
function earnedAt(booking) {
  return booking.completedAt ?? booking.cancellation?.cancelledAt ?? null;
}

/**
 * Build a payout for one tutor. Called by an admin, or by the scheduled job —
 * the logic is the same either way (§20).
 *
 * **The claim is the payout (S3).** Each lesson is claimed with a conditional
 * update that only matches while it has no `payoutId`, and the payout is
 * built from the documents those updates *returned* — never from the read
 * that found the candidates. Two runs at once (the cron and an administrator,
 * or two administrators) race on each lesson and exactly one wins it, so a
 * lesson can only ever be in one payout, and each payout only pays what it
 * actually claimed.
 *
 * Reading the amounts off the claimed document has a second purpose: a
 * refund landing on the same lesson either happened before the claim (its
 * `refundedCents` is in the document returned here, and it is netted) or
 * after it (the refund sees `payoutId` and raises a deduction instead). There
 * is no third case in which it is counted twice or not at all.
 */
export async function createPayout(tutorUserId, actor, { now = new Date() } = {}) {
  const settings = await getSettings();
  const account = await PayoutAccount.findOne({ tutorUserId }).lean();

  if (!account?.payoutsEnabled) {
    throw new BusinessRuleError(
      "This tutor has not finished payout setup yet.",
      "PAYOUT_ACCOUNT_INCOMPLETE",
    );
  }

  const nothingPayable = () =>
    new BusinessRuleError(
      `No lessons are ready for payout. Earnings become payable ${settings.payoutHoldDays} days after a lesson is completed.`,
      "NOTHING_PAYABLE",
    );

  const candidates = await payableBookings(tutorUserId, settings, now);
  if (!candidates.length) throw nothingPayable();

  const payoutId = new Types.ObjectId();
  const holdCutoff = holdCutoffFor(settings, now);
  const claimed = [];

  for (const candidate of candidates) {
    const won = await Booking.findOneAndUpdate(
      {
        _id: candidate._id,
        payoutId: { $exists: false },
        ...payableBookingMatch(holdCutoff),
      },
      { $set: { payoutId } },
      { returnDocument: "after" },
    )
      .select("price refundedCents completedAt cancellation reference")
      .lean();
    if (won) claimed.push(won);
  }

  // Everything was taken by a concurrent run between the read and the claim.
  if (!claimed.length) throw nothingPayable();

  const totals = claimed.reduce(
    (acc, b) => {
      const kept = Math.max(0, (b.price?.totalCents ?? 0) - (b.refundedCents ?? 0));
      return {
        grossCents: acc.grossCents + kept,
        earningsCents: acc.earningsCents + netTutorEarnings(b.price, b.refundedCents),
      };
    },
    { grossCents: 0, earningsCents: 0 },
  );

  if (totals.earningsCents <= 0) {
    await Booking.updateMany({ payoutId }, { $unset: { payoutId: "" } });
    throw nothingPayable();
  }

  let deductions;
  let payout;
  try {
    deductions = await applyOpenAdjustments(tutorUserId, payoutId, totals.earningsCents, now);
    const amountCents = totals.earningsCents - deductions.adjustmentCents;
    const profile = await TutorProfile.findOne({ userId: tutorUserId }).select("_id").lean();
    const dates = claimed.map(earnedAt).filter(Boolean);

    payout = await Payout.create({
      _id: payoutId,
      reference: publicReference("PAY"),
      tutorUserId,
      tutorProfileId: profile?._id,
      bookingIds: claimed.map((b) => b._id),
      lessonCount: claimed.length,
      grossCents: totals.grossCents,
      commissionCents: totals.grossCents - totals.earningsCents,
      amountCents,
      // A payout whose lessons were entirely absorbed by earlier refunds has
      // nothing to send. It is still a payout — it is the record that those
      // lessons were settled, and against what — so it is created settled.
      status: amountCents > 0 ? PAYOUT_STATUS.PENDING : PAYOUT_STATUS.PAID,
      ...(amountCents > 0 ? {} : { paidAt: now }),
      periodStart: dates.length ? new Date(Math.min(...dates.map((d) => new Date(d).getTime()))) : undefined,
      periodEnd: dates.length ? new Date(Math.max(...dates.map((d) => new Date(d).getTime()))) : undefined,
    });
  } catch (error) {
    // Nothing was created, so nothing is claimed: the lessons and any
    // deduction go back to waiting for the next run.
    await releasePayoutClaims(payoutId);
    throw error;
  }

  const deducted = deductions.adjustmentCents;
  await notify({
    userId: tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title: `Payout of ${formatMoney(payout.amountCents)} created`,
    body:
      `Covering ${claimed.length} lesson${claimed.length === 1 ? "" : "s"}.` +
      (deducted > 0 ? ` ${formatMoney(deducted)} was deducted for refunds on lessons already paid out.` : "") +
      (deducted < 0 ? ` Includes ${formatMoney(-deducted)} returned from an earlier deduction.` : ""),
    href: "/tutor/payouts",
    entityType: "Payout",
    entityId: payout._id,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PAYOUT_CREATED,
    entityType: "Payout",
    entityId: payout._id,
    metadata: {
      amountCents: payout.amountCents,
      earningsCents: totals.earningsCents,
      adjustmentCents: deducted,
      adjustmentIds: deductions.adjustmentIds.map(String),
      lessonCount: claimed.length,
    },
  });

  return { ...toPlain(payout), adjustmentCents: deducted };
}

/**
 * Apply a tutor's open adjustments to a payout being built.
 *
 * Amounts owed back to the tutor go first, then deductions oldest-first, as
 * far as the payout's earnings will cover. A deduction larger than what is
 * left is split: the part that fits is applied here, the rest stays OPEN for
 * the next payout. Each row is claimed on its OPEN status, so two payouts
 * built at once can never both apply the same one.
 */
async function applyOpenAdjustments(tutorUserId, payoutId, earningsCents, now) {
  const open = await PayoutAdjustment.find({
    tutorUserId,
    status: PAYOUT_ADJUSTMENT_STATUS.OPEN,
  }).lean();

  open.sort((a, b) => {
    const aCredit = a.amountCents < 0;
    const bCredit = b.amountCents < 0;
    if (aCredit !== bCredit) return aCredit ? -1 : 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });

  let adjustmentCents = 0;
  const adjustmentIds = [];

  for (const row of open) {
    const room = earningsCents - adjustmentCents;
    if (row.amountCents > 0 && room <= 0) break;

    const claimed = await PayoutAdjustment.findOneAndUpdate(
      { _id: row._id, status: PAYOUT_ADJUSTMENT_STATUS.OPEN },
      { $set: { status: PAYOUT_ADJUSTMENT_STATUS.APPLIED, appliedPayoutId: payoutId, appliedAt: now } },
      { returnDocument: "after" },
    ).lean();
    if (!claimed) continue;

    if (claimed.amountCents > room) {
      const remainder = claimed.amountCents - room;
      await PayoutAdjustment.updateOne({ _id: claimed._id }, { $set: { amountCents: room } });
      await PayoutAdjustment.create({
        tutorUserId,
        bookingId: claimed.bookingId,
        sourcePayoutId: claimed.sourcePayoutId,
        amountCents: remainder,
        reason: claimed.reason,
        createdBy: claimed.createdBy,
      });
      adjustmentCents += room;
      adjustmentIds.push(claimed._id);
      break;
    }

    adjustmentCents += claimed.amountCents;
    adjustmentIds.push(claimed._id);
  }

  return { adjustmentCents, adjustmentIds };
}

/** Undo every claim a payout holds: its lessons, and the adjustments it applied. */
async function releasePayoutClaims(payoutId) {
  await Booking.updateMany({ payoutId }, { $unset: { payoutId: "" } });
  await PayoutAdjustment.updateMany(
    { appliedPayoutId: payoutId, status: PAYOUT_ADJUSTMENT_STATUS.APPLIED },
    {
      $set: { status: PAYOUT_ADJUSTMENT_STATUS.OPEN },
      $unset: { appliedPayoutId: "", appliedAt: "" },
    },
  );
}

/**
 * A payout failed: it is terminal, and everything it held goes back (S3).
 *
 * Its lessons are released to be paid by a new payout, which nets their
 * refunds in the ordinary way. That makes any deduction raised *against*
 * this payout's lessons redundant — the refund is now in the lesson itself —
 * so an open one is voided, and one already taken from a later payout is
 * paid back with an equal and opposite adjustment.
 */
async function settleFailedPayout(payout, actor) {
  await releasePayoutClaims(payout._id);

  await PayoutAdjustment.updateMany(
    { sourcePayoutId: payout._id, status: PAYOUT_ADJUSTMENT_STATUS.OPEN },
    { $set: { status: PAYOUT_ADJUSTMENT_STATUS.VOID } },
  );

  const alreadyTaken = await PayoutAdjustment.find({
    sourcePayoutId: payout._id,
    status: PAYOUT_ADJUSTMENT_STATUS.APPLIED,
    amountCents: { $gt: 0 },
  }).lean();

  for (const row of alreadyTaken) {
    await PayoutAdjustment.create({
      tutorUserId: row.tutorUserId,
      bookingId: row.bookingId,
      amountCents: -row.amountCents,
      reason: `Returned: payout ${payout.reference} failed, so its lessons are paid again net of the refund.`,
      createdBy: actor?.id,
    });
  }
}

// --- Moving a payout on (S3, R28.19) ----------------------------------------

/**
 * Move a payout to a new status.
 *
 * The allowed moves are `PAYOUT_STATUS_TRANSITIONS`, and the move itself is a
 * conditional update on the status the payout was read in. That is what
 * stops a FAILED payout — whose lessons were already released to another
 * payout — being marked PAID and paying them twice, and what stops two
 * administrators both sending the transfer.
 *
 * Money moves on the first step that says it has: IN_TRANSIT or PAID sends
 * the transfer if none has been sent. The status is claimed *before* the
 * provider is called and handed back if the provider refuses, so a failed
 * transfer leaves the payout exactly where it was.
 */
export async function updatePayoutStatus(payoutId, { status, note, scheduledFor }, actor) {
  const payout = await Payout.findById(payoutId).lean();
  if (!payout) throw new NotFoundError("That payout no longer exists.");

  // Asking for the status it is already in changes nothing — in particular,
  // re-marking a payout paid must never move money twice.
  if (payout.status === status) return toPlain(payout);

  const allowed = PAYOUT_STATUS_TRANSITIONS[payout.status] ?? [];
  if (!allowed.includes(status)) {
    throw new BusinessRuleError(
      `A ${PAYOUT_STATUS_LABELS[payout.status]?.toLowerCase() ?? payout.status} payout cannot be marked ` +
        `${PAYOUT_STATUS_LABELS[status]?.toLowerCase() ?? status}.` +
        (payout.status === PAYOUT_STATUS.FAILED
          ? " Its lessons were released for a new payout — create one instead."
          : ""),
      "INVALID_PAYOUT_TRANSITION",
    );
  }

  const sendsMoney =
    (status === PAYOUT_STATUS.PAID || status === PAYOUT_STATUS.IN_TRANSIT) &&
    !payout.providerTransferId &&
    payout.amountCents > 0;

  let account = null;
  if (sendsMoney) {
    account = await PayoutAccount.findOne({ tutorUserId: payout.tutorUserId }).lean();
    if (!account?.payoutsEnabled) {
      throw new BusinessRuleError(
        "This tutor's payout account is not enabled, so money cannot be sent yet.",
        "PAYOUT_ACCOUNT_INCOMPLETE",
      );
    }
  }

  const now = new Date();
  const claimed = await Payout.findOneAndUpdate(
    { _id: payout._id, status: payout.status },
    {
      $set: {
        status,
        processedBy: actor.id,
        ...(scheduledFor ? { scheduledFor: new Date(scheduledFor) } : {}),
        ...(status === PAYOUT_STATUS.PAID && !sendsMoney ? { paidAt: now } : {}),
        ...(status === PAYOUT_STATUS.FAILED
          ? { failureReason: note || "Marked as failed by an administrator." }
          : {}),
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw new ConflictError("This payout was updated by someone else. Refresh to see its current status.");
  }

  if (sendsMoney) {
    let transfer;
    try {
      transfer = await (await getPaymentProvider()).createTransfer({
        accountId: account.providerAccountId,
        amountCents: payout.amountCents,
        currency: payout.currency,
        metadata: { payoutReference: payout.reference, tutorUserId: String(payout.tutorUserId) },
        // The payout reference is stable, so a retried transfer is recognised
        // by the provider instead of sending a second one.
        idempotencyKey: `transfer-${payout.reference}`,
      });
    } catch (error) {
      await Payout.updateOne(
        { _id: payout._id, status },
        { $set: { status: payout.status }, ...(payout.processedBy ? {} : { $unset: { processedBy: "" } }) },
      );
      throw error;
    }
    claimed.providerTransferId = transfer.transferId;
    if (status === PAYOUT_STATUS.PAID) claimed.paidAt = now;
    await Payout.updateOne(
      { _id: payout._id },
      {
        $set: {
          providerTransferId: transfer.transferId,
          ...(status === PAYOUT_STATUS.PAID ? { paidAt: now } : {}),
        },
      },
    );
  }

  if (status === PAYOUT_STATUS.FAILED) await settleFailedPayout(claimed, actor);

  const tutor = await User.findById(payout.tutorUserId).select("firstName").lean();
  const paid = status === PAYOUT_STATUS.PAID;

  await notify({
    userId: payout.tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title: paid
      ? `${formatMoney(payout.amountCents)} is on its way`
      : `Payout ${payout.reference} is now ${PAYOUT_STATUS_LABELS[status].toLowerCase()}`,
    body:
      status === PAYOUT_STATUS.FAILED
        ? `${note ? `${note} ` : ""}Its lessons will be included in your next payout.`
        : note,
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
    action: paid ? AUDIT_ACTIONS.PAYOUT_MARKED_PAID : AUDIT_ACTIONS.PAYOUT_STATUS_CHANGED,
    entityType: "Payout",
    entityId: payout._id,
    metadata: { from: payout.status, to: status, note, transferId: claimed.providerTransferId ?? null },
  });

  return toPlain(claimed);
}

// --- Refunds that reach a lesson (S3, R16.4) ---------------------------------

/**
 * Record money given back on one lesson.
 *
 * Every refund path — cancellation, no-show, dispute, an administrator's
 * refund, a refund made at the provider — ends here, through
 * `payment.service`, so `Booking.refundedCents` is the one figure every
 * payout and earnings report nets against.
 *
 * The increment returns the document as it was *before*, atomically. If the
 * lesson had already been claimed by a payout at that instant, that payout
 * paid the tutor's share of money that has now gone back; the difference is
 * recorded as a deduction on their next payout rather than disappearing.
 * A lesson in a FAILED payout is not "paid out": it was released, and will
 * be paid net of this refund.
 *
 * @returns {Promise<{ adjustment: object|null }>}
 */
export async function recordBookingRefund(bookingId, amountCents, { reason, actor } = {}) {
  if (!bookingId || !Number.isFinite(amountCents) || amountCents <= 0) return { adjustment: null };

  const before = await Booking.findOneAndUpdate(
    { _id: bookingId },
    { $inc: { refundedCents: Math.round(amountCents) } },
    { returnDocument: "before" },
  )
    .select("price refundedCents payoutId tutorUserId reference")
    .lean();

  if (!before?.payoutId) return { adjustment: null };

  const payout = await Payout.findById(before.payoutId).select("status reference").lean();
  if (!payout || payout.status === PAYOUT_STATUS.FAILED) return { adjustment: null };

  const refundedBefore = before.refundedCents ?? 0;
  const deduction =
    netTutorEarnings(before.price, refundedBefore) -
    netTutorEarnings(before.price, refundedBefore + Math.round(amountCents));
  if (deduction <= 0) return { adjustment: null };

  const adjustment = await PayoutAdjustment.create({
    tutorUserId: before.tutorUserId,
    bookingId: before._id,
    sourcePayoutId: payout._id,
    amountCents: deduction,
    reason: `Refund on ${before.reference} after payout ${payout.reference}${reason ? ` — ${reason}` : ""}`,
    createdBy: actor?.id,
  });

  await recordAudit({
    actor: actor ?? { role: "SYSTEM" },
    action: AUDIT_ACTIONS.PAYOUT_ADJUSTMENT_RECORDED,
    entityType: "Booking",
    entityId: before._id,
    metadata: {
      adjustmentId: String(adjustment._id),
      payoutId: String(payout._id),
      deductionCents: deduction,
      refundCents: Math.round(amountCents),
    },
  });

  await notify({
    userId: before.tutorUserId,
    type: NOTIFICATION_TYPES.PAYOUT_UPDATED,
    title: `${formatMoney(deduction)} will be deducted from your next payout`,
    body: `Part of lesson ${before.reference} was refunded after it was paid out to you.`,
    href: "/tutor/payouts",
    entityType: "Booking",
    entityId: before._id,
  }).catch((error) => console.warn("[payout] adjustment notice failed:", error.message));

  return { adjustment: toPlain(adjustment) };
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

  // The deductions each payout carried, so a payout smaller than its lessons
  // explains itself (S3).
  const applied = items.length
    ? await PayoutAdjustment.aggregate([
        { $match: { appliedPayoutId: { $in: items.map((p) => p._id) } } },
        { $group: { _id: "$appliedPayoutId", adjustmentCents: { $sum: "$amountCents" } } },
      ])
    : [];
  const appliedBy = new Map(applied.map((row) => [String(row._id), row.adjustmentCents]));

  return {
    items: toPlain(items).map((payout) => ({
      ...payout,
      adjustmentCents: appliedBy.get(String(payout.id)) ?? 0,
      nextStatuses: PAYOUT_STATUS_TRANSITIONS[payout.status] ?? [],
    })),
    total,
    page,
    pageSize: size,
  };
}

/**
 * Create every payout that is due, for every tutor who can receive one (§20).
 *
 * This is the scheduled counterpart to an administrator pressing the button,
 * and it deliberately reuses `createPayout` rather than reimplementing
 * eligibility: hold period, the atomic claim and the deductions are all
 * defined once. Repeat runs are harmless — a lesson claimed by one run is
 * invisible to the next — and a run that overlaps an administrator's click
 * can only split the lessons between them, never pay one twice.
 *
 * @param {object} [options]
 * @param {object} [options.actor]  Who to attribute the audit entry to.
 */
export async function runScheduledPayouts({ actor, now } = {}) {
  const settings = await getSettings();
  if (settings.autoPayouts === false) {
    return { skipped: "AUTO_PAYOUTS_DISABLED", created: 0, amountCents: 0, tutors: 0 };
  }

  const pending = await pendingPayoutSummary({ now });
  const eligible = pending.filter((row) => row.payoutsEnabled);

  const system = actor ?? { id: null, role: ROLES.ADMIN };
  let created = 0;
  let amountCents = 0;
  const failures = [];

  for (const row of eligible) {
    try {
      const payout = await createPayout(row.tutorUserId, system, { now });
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

/**
 * Admin view: who is owed money right now (§20).
 *
 * Earnings are netted of refunds in the database (`netTutorEarningsExpression`
 * applies the same rule `createPayout` does), and each tutor's open
 * deductions are taken off, so the figure here is what pressing "Create
 * payout" would actually send.
 */
export async function pendingPayoutSummary({ now = new Date() } = {}) {
  const settings = await getSettings();

  const rows = await Booking.aggregate([
    {
      $match: {
        payoutId: { $exists: false },
        ...payableBookingMatch(holdCutoffFor(settings, now)),
        ...HAS_NET_EARNINGS,
      },
    },
    {
      $group: {
        _id: "$tutorUserId",
        earningsCents: { $sum: netTutorEarningsExpression() },
        lessonCount: { $sum: 1 },
        oldestCompletedAt: { $min: { $ifNull: ["$completedAt", "$cancellation.cancelledAt"] } },
      },
    },
    { $sort: { earningsCents: -1 } },
    { $limit: 100 },
  ]);

  const tutorIds = rows.map((r) => r._id);
  const [users, accounts, deductions] = await Promise.all([
    User.find({ _id: { $in: tutorIds } })
      .select("firstName lastName email")
      .lean(),
    PayoutAccount.find({ tutorUserId: { $in: tutorIds } }).lean(),
    openAdjustmentsByTutor(tutorIds),
  ]);

  const userMap = new Map(users.map((u) => [String(u._id), u]));
  const accountMap = new Map(accounts.map((a) => [String(a.tutorUserId), a]));

  return rows.map((row) => {
    const adjustmentCents = deductions.get(String(row._id)) ?? 0;
    return {
      tutorUserId: String(row._id),
      tutor: toPlain(userMap.get(String(row._id)) ?? null),
      earningsCents: row.earningsCents,
      adjustmentCents,
      amountCents: Math.max(0, row.earningsCents - adjustmentCents),
      lessonCount: row.lessonCount,
      oldestCompletedAt: row.oldestCompletedAt?.toISOString?.() ?? null,
      payoutsEnabled: accountMap.get(String(row._id))?.payoutsEnabled ?? false,
    };
  });
}

/** Signed sum of each tutor's OPEN adjustments (positive = owed by them). */
async function openAdjustmentsByTutor(tutorIds) {
  const match = { status: PAYOUT_ADJUSTMENT_STATUS.OPEN };
  if (tutorIds) match.tutorUserId = { $in: tutorIds.map(asObjectId) };
  const rows = await PayoutAdjustment.aggregate([
    { $match: match },
    { $group: { _id: "$tutorUserId", adjustmentCents: { $sum: "$amountCents" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.adjustmentCents]));
}

function asObjectId(id) {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

/**
 * Where one tutor's money stands, all time (R16.9, R23.7, R28.17).
 *
 * Every figure is summed in MongoDB, net of refunds:
 *
 *   earnedCents     their share of every lesson they earned, as kept
 *   paidOutCents    payouts that reached PAID
 *   inPayoutCents   payouts created and not yet paid (pending, scheduled, in transit)
 *   unclaimedCents  earned and in no payout yet — inside the hold or past it
 *   readyCents      the part of `unclaimed` already past the hold
 *   adjustmentCents open deductions waiting for the next payout
 *   pendingCents    everything earned and not yet paid out:
 *                   in-flight payouts + unclaimed − open deductions
 *
 * "Pending" is all time on purpose: a lesson earned last quarter and still
 * unpaid is owed now, whichever period the screen is showing.
 */
export async function tutorPayoutPosition(tutorUserId, { now = new Date() } = {}) {
  const [position] = await tutorPayoutPositions({ tutorUserIds: [tutorUserId], now });
  return (
    position ?? {
      tutorUserId: String(tutorUserId),
      earnedCents: 0,
      lessons: 0,
      paidOutCents: 0,
      inPayoutCents: 0,
      unclaimedCents: 0,
      readyCents: 0,
      adjustmentCents: 0,
      pendingCents: 0,
    }
  );
}

/**
 * The same position for many tutors at once — the admin's per-tutor earnings
 * view (R28.17). Without `tutorUserIds`, every tutor who has earned anything,
 * highest earner first.
 */
export async function tutorPayoutPositions({ tutorUserIds, now = new Date(), page = 1, pageSize } = {}) {
  const settings = await getSettings();
  const holdCutoff = holdCutoffFor(settings, now);
  const scope = tutorUserIds ? { tutorUserId: { $in: tutorUserIds.map(asObjectId) } } : {};
  const net = netTutorEarningsExpression();

  const earned = await Booking.aggregate([
    { $match: { ...scope, ...earningBookingMatch() } },
    {
      $group: {
        _id: "$tutorUserId",
        earnedCents: { $sum: net },
        lessons: { $sum: 1 },
        unclaimedCents: {
          $sum: { $cond: [{ $ifNull: ["$payoutId", false] }, 0, net] },
        },
        readyCents: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $not: [{ $ifNull: ["$payoutId", false] }] },
                  {
                    $lte: [{ $ifNull: ["$completedAt", "$cancellation.cancelledAt"] }, holdCutoff],
                  },
                ],
              },
              net,
              0,
            ],
          },
        },
      },
    },
    { $sort: { earnedCents: -1 } },
  ]);

  const size = pageSize ?? (tutorUserIds ? earned.length || 1 : PAGE_SIZES.adminTable);
  const pageRows = tutorUserIds ? earned : earned.slice((page - 1) * size, page * size);
  const ids = pageRows.map((r) => r._id);

  const [payouts, adjustments, users] = await Promise.all([
    Payout.aggregate([
      { $match: { tutorUserId: { $in: ids } } },
      {
        $group: {
          _id: "$tutorUserId",
          paidOutCents: {
            $sum: { $cond: [{ $eq: ["$status", PAYOUT_STATUS.PAID] }, "$amountCents", 0] },
          },
          inPayoutCents: {
            $sum: {
              $cond: [
                { $in: ["$status", [PAYOUT_STATUS.PENDING, PAYOUT_STATUS.SCHEDULED, PAYOUT_STATUS.IN_TRANSIT]] },
                "$amountCents",
                0,
              ],
            },
          },
        },
      },
    ]),
    openAdjustmentsByTutor(ids),
    tutorUserIds
      ? []
      : User.find({ _id: { $in: ids } }).select("firstName lastName email").lean(),
  ]);

  const payoutsBy = new Map(payouts.map((row) => [String(row._id), row]));
  const userBy = new Map(users.map((u) => [String(u._id), u]));

  const positions = pageRows.map((row) => {
    const key = String(row._id);
    const paid = payoutsBy.get(key) ?? { paidOutCents: 0, inPayoutCents: 0 };
    const adjustmentCents = adjustments.get(key) ?? 0;
    return {
      tutorUserId: key,
      ...(tutorUserIds ? {} : { tutor: toPlain(userBy.get(key) ?? null) }),
      earnedCents: row.earnedCents,
      lessons: row.lessons,
      paidOutCents: paid.paidOutCents,
      inPayoutCents: paid.inPayoutCents,
      unclaimedCents: row.unclaimedCents,
      readyCents: row.readyCents,
      adjustmentCents,
      pendingCents: Math.max(0, paid.inPayoutCents + row.unclaimedCents - adjustmentCents),
    };
  });

  if (tutorUserIds) return positions;
  return Object.assign(positions, { total: earned.length, page, pageSize: size });
}

/** A tutor's adjustments, newest first — what the payout screens itemise. */
export async function listPayoutAdjustments(actor, { tutorUserId, status, limit = 50 } = {}) {
  const query = {};
  if (actor.role === ROLES.TUTOR) query.tutorUserId = actor.id;
  else if (actor.role !== ROLES.ADMIN) throw new AuthorizationError();
  else if (tutorUserId) query.tutorUserId = tutorUserId;
  if (status) query.status = status;

  const rows = await PayoutAdjustment.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("bookingId", "reference courseName courseCode")
    .populate("tutorUserId", "firstName lastName")
    .lean();
  return toPlain(rows);
}

export { Types };
