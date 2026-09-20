import "server-only";
import { RiskCase, User, Booking, Payment, Dispute } from "@/models";
import {
  RISK_SIGNALS,
  RISK_SIGNAL_LABELS,
  RISK_CASE_STATUS,
  OPEN_RISK_CASE_STATUSES,
  RESOLVED_RISK_CASE_STATUSES,
  RISK_LEVELS,
  RISK_ACTIONS,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  DISPUTE_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
} from "@/constants";
import { NotFoundError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { addDays } from "@/lib/utils/time";
import { getSettings } from "./settings.service";
import { recordAudit } from "./audit.service";
import { notify } from "./notification.service";

/**
 * Fraud and risk (§41 Phase 2).
 *
 * The platform could already *notice* several kinds of trouble before this
 * existed — `lib/booking/policy.assessCancellationAbuse` decided an account
 * needed "an administrator's review", the referral service recorded risk
 * flags, disputes were raised — and none of it reached an administrator in a
 * form they could act on. This service is the missing middle: one place every
 * signal is sent, one record per account, one review workflow.
 *
 * The rules it holds to:
 *
 *   **It detects; it never punishes.** No score, however high, restricts an
 *   account. The requirements authorise no penalty, so the platform invents
 *   none. The only restriction reachable from a case is the suspension an
 *   administrator could always apply by hand, applied by a person, recorded
 *   on the case and audited through the ordinary user-management path.
 *
 *   **Every signal is idempotent.** Callers pass a `dedupeKey` derived from
 *   the thing that happened, not from the moment it was noticed. A replayed
 *   webhook, a retried job or a double-submitted form records one signal. The
 *   unique index on `signals.dedupeKey` is what actually enforces that; the
 *   check below is only for a useful return value.
 *
 *   **Detection never breaks the thing being done.** A cancellation must not
 *   fail because the risk service was unhappy, so every call site wraps this
 *   in `safelyRecordRiskSignal`, which logs and swallows. A missed signal is a
 *   gap in a report; a thrown one is a family unable to cancel a lesson.
 *
 *   **Thresholds belong to the operator.** Everything undefined by §41 lives
 *   in `settings.risk` — except the cancellation threshold, which already
 *   existed as `cancellationAbuseThreshold` and is read from there rather
 *   than copied.
 */

// --- Scoring ----------------------------------------------------------------

/**
 * A case's score is how many *distinct kinds* of trouble fired inside the
 * window — not how many events, and not a weighted total.
 *
 * Counting events would let one bad week of declined cards outrank an account
 * with a cancellation problem, a dispute and a flagged referral. Weighting the
 * kinds against each other would be a risk model the requirements do not
 * define. Distinct kinds is the honest middle: it is exactly what an
 * administrator would count by reading the case.
 */
export function scoreSignals(signals, { now = new Date(), windowDays } = {}) {
  const since = addDays(now, -windowDays);
  const active = (signals ?? []).filter((s) => new Date(s.detectedAt) >= since);
  return new Set(active.map((s) => s.type)).size;
}

/** Where a score sits against the operator's thresholds. */
export function levelForScore(score, settings) {
  const risk = settings?.risk ?? {};
  if (score >= (risk.highScore ?? 4)) return RISK_LEVELS.HIGH;
  if (score >= (risk.reviewScore ?? 2)) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
}

// --- Recording --------------------------------------------------------------

/**
 * Record one risk signal against an account.
 *
 * Appends to the account's open case, or opens one. Returns what happened so
 * a caller can tell "recorded" from "already known" without inspecting the
 * database.
 *
 * @param {object} input
 * @param {string} input.subjectUserId  Whose behaviour this is about.
 * @param {string} input.type           One of `RISK_SIGNALS`.
 * @param {string} input.dedupeKey      Stable per *occurrence*, not per call.
 * @param {string} [input.summary]      One sentence for the reviewer.
 * @param {object} [input.evidence]     Small, non-sensitive counts/references.
 * @returns {Promise<{recorded: boolean, reason?: string, case?: object}>}
 */
export async function recordRiskSignal({
  subjectUserId,
  type,
  dedupeKey,
  summary,
  evidence,
  entityType,
  entityId,
  now = new Date(),
} = {}) {
  if (!subjectUserId || !type || !dedupeKey) {
    throw new BusinessRuleError(
      "A risk signal needs a subject, a type and a deduplication key.",
      "RISK_SIGNAL_INCOMPLETE",
    );
  }

  const settings = await getSettings();
  if (settings.risk?.enabled === false) return { recorded: false, reason: "DISABLED" };

  // Cheap pre-check for a useful answer; the unique index is the real guard.
  const seen = await RiskCase.findOne({ "signals.dedupeKey": dedupeKey }).select("_id").lean();
  if (seen) return { recorded: false, reason: "ALREADY_RECORDED" };

  const subject = await User.findById(subjectUserId).select("_id role").lean();
  if (!subject) return { recorded: false, reason: "NO_SUBJECT" };

  const signal = {
    type,
    detectedAt: now,
    summary: summary ?? RISK_SIGNAL_LABELS[type],
    evidence,
    entityType,
    entityId,
    dedupeKey,
  };

  let riskCase;
  let opened = false;

  try {
    // Claim-or-create in one round trip, so two signals firing together do
    // not each try to open a case.
    riskCase = await RiskCase.findOneAndUpdate(
      { subjectUserId: subject._id, status: { $in: OPEN_RISK_CASE_STATUSES } },
      {
        $push: { signals: signal },
        $set: { lastSignalAt: now },
        $setOnInsert: {
          reference: publicReference("RSK"),
          subjectUserId: subject._id,
          subjectRole: subject.role,
          status: RISK_CASE_STATUS.OPEN,
          firstDetectedAt: now,
        },
      },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
    );
    opened = riskCase.signals.length === 1;
  } catch (error) {
    // Either the signal was recorded concurrently, or a case was opened
    // concurrently. Both mean "already handled", which is the point.
    if (error?.code === 11000) return { recorded: false, reason: "ALREADY_RECORDED" };
    throw error;
  }

  const rescored = await rescore(riskCase, settings, now);

  await recordAudit({
    actor: { role: "SYSTEM" },
    action: opened ? AUDIT_ACTIONS.RISK_CASE_OPENED : AUDIT_ACTIONS.RISK_SIGNAL_RECORDED,
    entityType: "RiskCase",
    entityId: rescored._id,
    metadata: {
      subjectUserId: String(subject._id),
      signal: type,
      score: rescored.score,
      level: rescored.level,
    },
  });

  return { recorded: true, opened, case: toPlain(rescored) };
}

/**
 * Detection must never break the thing that was being done.
 *
 * Every integration point calls this rather than `recordRiskSignal` directly:
 * a cancellation, a refund or a webhook acknowledgement is more important
 * than noticing something about it.
 */
export async function safelyRecordRiskSignal(input) {
  try {
    return await recordRiskSignal(input);
  } catch (error) {
    console.warn("[risk] failed to record signal:", error.message);
    return { recorded: false, reason: "ERROR" };
  }
}

/** Recompute score and level from the stored signals. */
async function rescore(riskCase, settings, now) {
  const windowDays = settings.risk?.signalWindowDays ?? 30;
  const score = scoreSignals(riskCase.signals, { now, windowDays });
  const level = levelForScore(score, settings);

  if (riskCase.score === score && riskCase.level === level) return riskCase;

  riskCase.score = score;
  riskCase.level = level;
  await riskCase.save();
  return riskCase;
}

// --- Detectors ---------------------------------------------------------------
//
// Each of these turns an event the platform already handles into a signal.
// They count from stored state rather than from what the caller believed, so
// a replayed event cannot inflate a count, and they fire only at the
// operator's threshold.

/**
 * Repeated cancellations (§26).
 *
 * The decision of *whether* this is abuse already belongs to
 * `lib/booking/policy.assessCancellationAbuse`, and is not second-guessed
 * here — this records the outcome that policy reached. Only its strongest
 * verdict becomes a signal: "REVIEW" is the one that literally says an
 * administrator should look, and before this existed nothing made that
 * happen.
 *
 * The key is bucketed by day, so an account that cancels five more lessons
 * this afternoon adds one signal, not five.
 */
export async function reportCancellationAbuse({ userId, assessment, now = new Date() }) {
  if (assessment?.action !== "REVIEW") return { recorded: false, reason: "BELOW_THRESHOLD" };

  return safelyRecordRiskSignal({
    subjectUserId: userId,
    type: RISK_SIGNALS.REPEATED_CANCELLATIONS,
    dedupeKey: `cancellations:${userId}:${dayKey(now)}`,
    summary: `${assessment.recentCancellations} cancellations inside the platform's rolling window.`,
    evidence: { cancellations: assessment.recentCancellations, verdict: assessment.action },
    entityType: "User",
    entityId: userId,
    now,
  });
}

/**
 * A pattern of not turning up.
 *
 * Counted from the bookings themselves, so the signal reflects the record
 * rather than the report that triggered the check. The key names the booking
 * that tipped it over, which is both stable and useful to a reviewer.
 */
export async function checkNoShowPattern({ userId, role, bookingId, now = new Date() }) {
  const settings = await getSettings();
  if (settings.risk?.enabled === false) return { recorded: false, reason: "DISABLED" };

  const threshold = settings.risk?.noShowThreshold ?? 3;
  const since = addDays(now, -(settings.risk?.signalWindowDays ?? 30));

  const field = role === "TUTOR" ? "tutorUserId" : "purchaserId";
  const status =
    role === "TUTOR" ? BOOKING_STATUS.NO_SHOW_TUTOR : BOOKING_STATUS.NO_SHOW_STUDENT;

  const count = await Booking.countDocuments({
    [field]: userId,
    status,
    startAt: { $gte: since },
  });

  if (count < threshold) return { recorded: false, reason: "BELOW_THRESHOLD", count };

  return safelyRecordRiskSignal({
    subjectUserId: userId,
    type: RISK_SIGNALS.NO_SHOW_PATTERN,
    dedupeKey: `no-show:${userId}:${bookingId}`,
    summary: `${count} lessons not attended in the last ${settings.risk?.signalWindowDays ?? 30} days.`,
    evidence: { noShows: count, threshold, as: role },
    entityType: "Booking",
    entityId: bookingId,
    now,
  });
}

/**
 * Repeated declined payments.
 *
 * A handful of failures is a card that expired; a run of them can be somebody
 * testing stolen numbers, which is the one signal here that is about the
 * platform's own exposure rather than about a rude customer.
 */
export async function checkPaymentFailures({ userId, paymentId, now = new Date() }) {
  const settings = await getSettings();
  if (settings.risk?.enabled === false) return { recorded: false, reason: "DISABLED" };

  const threshold = settings.risk?.paymentFailureThreshold ?? 3;
  const since = addDays(now, -(settings.risk?.signalWindowDays ?? 30));

  const count = await Payment.countDocuments({
    purchaserId: userId,
    status: PAYMENT_STATUS.FAILED,
    updatedAt: { $gte: since },
  });

  if (count < threshold) return { recorded: false, reason: "BELOW_THRESHOLD", count };

  return safelyRecordRiskSignal({
    subjectUserId: userId,
    type: RISK_SIGNALS.PAYMENT_FAILURES,
    dedupeKey: `payment-failure:${userId}:${paymentId}`,
    summary: `${count} payment attempts declined in the last ${settings.risk?.signalWindowDays ?? 30} days.`,
    evidence: { failures: count, threshold },
    entityType: "Payment",
    entityId: paymentId,
    now,
  });
}

/**
 * Several disputes naming the same account.
 *
 * Counted against the person a dispute is *about*, not the person who raised
 * it: opening a dispute is a right, and a family who has had two bad lessons
 * is not a fraud risk for saying so.
 */
export async function checkDisputePattern({ againstUserId, disputeId, now = new Date() }) {
  if (!againstUserId) return { recorded: false, reason: "NO_SUBJECT" };

  const settings = await getSettings();
  if (settings.risk?.enabled === false) return { recorded: false, reason: "DISABLED" };

  const threshold = settings.risk?.disputeThreshold ?? 2;
  const since = addDays(now, -(settings.risk?.signalWindowDays ?? 30));

  const count = await Dispute.countDocuments({
    againstUserId,
    createdAt: { $gte: since },
    // A dispute an administrator threw out is not evidence against anybody.
    status: { $ne: DISPUTE_STATUS.REJECTED },
  });

  if (count < threshold) return { recorded: false, reason: "BELOW_THRESHOLD", count };

  return safelyRecordRiskSignal({
    subjectUserId: againstUserId,
    type: RISK_SIGNALS.REPEATED_DISPUTES,
    dedupeKey: `dispute:${againstUserId}:${disputeId}`,
    summary: `${count} disputes raised against this account in the last ${settings.risk?.signalWindowDays ?? 30} days.`,
    evidence: { disputes: count, threshold },
    entityType: "Dispute",
    entityId: disputeId,
    now,
  });
}

/**
 * A referral the referral service flagged.
 *
 * The flags themselves are computed there and are not recomputed here — this
 * only brings them somewhere an administrator will see them alongside
 * whatever else that account has been doing.
 */
export async function reportReferralRisk({ referrerUserId, referralId, flags, now = new Date() }) {
  if (!flags?.length) return { recorded: false, reason: "NO_FLAGS" };

  return safelyRecordRiskSignal({
    subjectUserId: referrerUserId,
    type: RISK_SIGNALS.REFERRAL_ABUSE,
    dedupeKey: `referral:${referralId}`,
    summary: `A referral from this account was flagged: ${flags.join(", ").toLowerCase().replaceAll("_", " ")}.`,
    evidence: { flags },
    entityType: "Referral",
    entityId: referralId,
    now,
  });
}

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// --- Review -------------------------------------------------------------------

export async function listRiskCases({ status, level, subjectUserId, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;
  if (level) query.level = level;
  if (subjectUserId) query.subjectUserId = subjectUserId;

  const [items, total, openCount] = await Promise.all([
    RiskCase.find(query)
      .sort({ lastSignalAt: -1, _id: 1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("subjectUserId", "firstName lastName email role status")
      .populate("reviewedBy", "firstName lastName")
      .populate("resolvedBy", "firstName lastName")
      .lean(),
    RiskCase.countDocuments(query),
    RiskCase.countDocuments({ status: { $in: OPEN_RISK_CASE_STATUSES } }),
  ]);

  return { items: toPlain(items), total, openCount, page, pageSize: size };
}

export async function getRiskCase(id) {
  const riskCase = await RiskCase.findById(id)
    .populate("subjectUserId", "firstName lastName email role status createdAt")
    .populate("reviewedBy", "firstName lastName")
    .populate("resolvedBy", "firstName lastName")
    .populate("actions.byId", "firstName lastName")
    .lean();
  if (!riskCase) throw new NotFoundError("That risk case no longer exists.");
  return toPlain(riskCase);
}

/** Take a case. Idempotent — claiming one already being reviewed is fine. */
export async function reviewRiskCase(id, admin) {
  const riskCase = await loadOpenCase(id);
  if (riskCase.status === RISK_CASE_STATUS.UNDER_REVIEW) return toPlain(riskCase);

  riskCase.status = RISK_CASE_STATUS.UNDER_REVIEW;
  riskCase.reviewedBy = admin.id;
  riskCase.reviewedAt = new Date();
  await riskCase.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.RISK_CASE_REVIEWED,
    entityType: "RiskCase",
    entityId: riskCase._id,
    metadata: { subjectUserId: String(riskCase.subjectUserId), score: riskCase.score },
  });

  return toPlain(riskCase);
}

/**
 * Close a case with a decision.
 *
 * `action` records what was done about it and is not the doing of it: a
 * suspension is applied through the ordinary user-management route, by an
 * administrator, with its own audit entry. Recording it here would let a risk
 * review become a second, quieter way to restrict an account.
 *
 * A note is required for a confirmation. "We decided this account was
 * fraudulent" with no reason is not a record anybody can defend later.
 */
export async function resolveRiskCase(id, { resolution, note, action }, admin) {
  const riskCase = await loadOpenCase(id);

  if (!RESOLVED_RISK_CASE_STATUSES.includes(resolution)) {
    throw new BusinessRuleError(
      "A case is resolved as confirmed or cleared.",
      "RISK_RESOLUTION_INVALID",
    );
  }

  if (resolution === RISK_CASE_STATUS.CONFIRMED && (note?.trim().length ?? 0) < 10) {
    throw new BusinessRuleError(
      "Record why this was confirmed — at least a sentence.",
      "RISK_NOTE_REQUIRED",
    );
  }

  riskCase.status = resolution;
  riskCase.resolvedBy = admin.id;
  riskCase.resolvedAt = new Date();
  riskCase.resolutionNote = note;
  riskCase.reviewedBy = riskCase.reviewedBy ?? admin.id;
  riskCase.reviewedAt = riskCase.reviewedAt ?? new Date();
  riskCase.actions.push({
    action: action ?? RISK_ACTIONS.NONE,
    byId: admin.id,
    note,
  });
  await riskCase.save();

  if (action === RISK_ACTIONS.WARNING_ISSUED) {
    await notify({
      userId: riskCase.subjectUserId,
      type: NOTIFICATION_TYPES.ACCOUNT_UNDER_REVIEW,
      title: "A note about your account",
      body:
        "Our team has reviewed recent activity on your account. Please get in touch with support if you have any questions.",
      href: "/support",
      entityType: "RiskCase",
      entityId: riskCase._id,
    });
  }

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.RISK_CASE_RESOLVED,
    entityType: "RiskCase",
    entityId: riskCase._id,
    metadata: {
      subjectUserId: String(riskCase.subjectUserId),
      resolution,
      action: action ?? RISK_ACTIONS.NONE,
      score: riskCase.score,
      signals: riskCase.signals.map((s) => s.type),
    },
  });

  return toPlain(riskCase);
}

async function loadOpenCase(id) {
  const riskCase = await RiskCase.findById(id);
  if (!riskCase) throw new NotFoundError("That risk case no longer exists.");
  if (RESOLVED_RISK_CASE_STATUSES.includes(riskCase.status)) {
    throw new BusinessRuleError(
      `This case was already ${riskCase.status.toLowerCase()}. A new signal will open a fresh one.`,
      "RISK_CASE_RESOLVED",
    );
  }
  return riskCase;
}

/** Headline counts for the admin overview. */
export async function riskOverview() {
  const [open, underReview, high, confirmed] = await Promise.all([
    RiskCase.countDocuments({ status: RISK_CASE_STATUS.OPEN }),
    RiskCase.countDocuments({ status: RISK_CASE_STATUS.UNDER_REVIEW }),
    RiskCase.countDocuments({
      status: { $in: OPEN_RISK_CASE_STATUSES },
      level: RISK_LEVELS.HIGH,
    }),
    RiskCase.countDocuments({ status: RISK_CASE_STATUS.CONFIRMED }),
  ]);

  return { open, underReview, high, confirmed, needsAttention: open + underReview };
}
