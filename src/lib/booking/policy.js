import {
  BOOKING_STATUS,
  CANCELLED_STATUSES,
  PAYMENT_STATUS,
  CHECKOUT_HOLD,
  DEFAULT_SETTINGS,
  DISPUTE_REASONS,
} from "@/constants";
import { hoursUntil } from "@/lib/utils/time";
import { calculateRefund } from "./pricing";

/**
 * Cancellation, refund and no-show rules (§26, §42).
 *
 * Every cancellation path in the product — student, tutor, admin, dispute —
 * resolves its outcome here, so the policy can never diverge between the UI,
 * the API and the admin tools.
 */

export const POLICY = {
  FREE_CANCELLATION: "FREE_CANCELLATION",
  LATE_CANCELLATION: "LATE_CANCELLATION",
  TUTOR_CANCELLATION: "TUTOR_CANCELLATION",
  ADMIN_CANCELLATION: "ADMIN_CANCELLATION",
  STUDENT_NO_SHOW: "STUDENT_NO_SHOW",
  TUTOR_NO_SHOW: "TUTOR_NO_SHOW",
  /**
   * Cancelled before any money was taken (R27.2). Nothing is refunded because
   * nothing was collected; the checkout is voided instead. Recorded on the
   * booking so a payment that settles *afterwards* is recognised as money
   * taken for a lesson that no longer exists, and sent back.
   */
  UNPAID_CANCELLATION: "UNPAID_CANCELLATION",
};

export const POLICY_LABELS = {
  FREE_CANCELLATION: "Free cancellation",
  LATE_CANCELLATION: "Late cancellation",
  TUTOR_CANCELLATION: "Cancelled by tutor",
  ADMIN_CANCELLATION: "Cancelled by APlus Learn",
  STUDENT_NO_SHOW: "Student did not attend",
  TUTOR_NO_SHOW: "Tutor did not attend",
  UNPAID_CANCELLATION: "Cancelled before payment",
};

/**
 * Resolve the refund for a cancellation.
 *
 * @param {object} args
 * @param {Date|string} args.startAt      When the lesson begins.
 * @param {number} args.totalCents        The lesson's value (its list price).
 * @param {"STUDENT"|"TUTOR"|"ADMIN"} args.cancelledBy
 * @param {object} args.settings          Platform settings (admin-configurable).
 * @param {boolean} [args.paid=true]      Whether any money was collected for
 *   it. An unpaid booking resolves to UNPAID_CANCELLATION whoever cancels:
 *   there is nothing to refund, and saying "$X will be refunded" to someone
 *   who was never charged is the defect R27.2 describes.
 */
export function resolveCancellation({ startAt, totalCents, cancelledBy, settings, paid = true }) {
  const hoursBeforeStart = hoursUntil(startAt);

  if (!paid) {
    return outcome(POLICY.UNPAID_CANCELLATION, 0, totalCents, hoursBeforeStart);
  }

  // A tutor or admin cancelling is never the student's fault: always full.
  if (cancelledBy === "TUTOR") {
    return outcome(POLICY.TUTOR_CANCELLATION, 100, totalCents, hoursBeforeStart);
  }
  if (cancelledBy === "ADMIN") {
    return outcome(POLICY.ADMIN_CANCELLATION, 100, totalCents, hoursBeforeStart);
  }

  // Student cancelling: inside the notice window it is free, outside it the
  // configured late-cancellation percentage applies.
  if (hoursBeforeStart >= settings.freeCancellationWindowHours) {
    return outcome(POLICY.FREE_CANCELLATION, 100, totalCents, hoursBeforeStart);
  }
  return outcome(
    POLICY.LATE_CANCELLATION,
    settings.lateCancellationRefundPercent,
    totalCents,
    hoursBeforeStart,
  );
}

export function resolveNoShow({ party, totalCents, settings }) {
  const percent =
    party === "TUTOR" ? settings.tutorNoShowRefundPercent : settings.studentNoShowRefundPercent;
  const policy = party === "TUTOR" ? POLICY.TUTOR_NO_SHOW : POLICY.STUDENT_NO_SHOW;
  return outcome(policy, percent, totalCents, 0);
}

function outcome(policyApplied, refundPercent, totalCents, hoursBeforeStart) {
  return {
    policyApplied,
    policyLabel: POLICY_LABELS[policyApplied],
    refundPercent,
    refundCents: calculateRefund(totalCents, refundPercent),
    hoursBeforeStart: Math.round(hoursBeforeStart * 10) / 10,
  };
}

/** Human-readable policy text shown before the student confirms a booking. */
export function cancellationPolicyText(settings) {
  return [
    `Cancel free of charge up to ${settings.freeCancellationWindowHours} hours before the lesson starts.`,
    settings.lateCancellationRefundPercent > 0
      ? `Cancel inside ${settings.freeCancellationWindowHours} hours and ${settings.lateCancellationRefundPercent}% is refunded.`
      : `Cancellations inside ${settings.freeCancellationWindowHours} hours are not refunded.`,
    "If your tutor cancels, you are refunded in full.",
    // A tutor no-show is reviewed before money moves (S2), so the promise is
    // the review and the window, not an automatic refund.
    `If your tutor does not attend, report it within ${noShowWindowHours(settings)} hours of the lesson ending and our team will review it for a refund.`,
  ];
}

// --- The unpaid hold (§19, §20) --------------------------------------------

/**
 * When an unpaid booking stops holding its slot.
 *
 * Measured from when the booking was created rather than from the checkout
 * session, because a booking can exist without a session at all — a crash
 * between `Booking.create` and `createPaymentForBooking` leaves exactly that,
 * and it is the case that must never block a calendar forever.
 *
 * Where the provider gave us its own session expiry, the later of the two
 * wins: releasing a slot while the purchaser still has a live payment page
 * open would take the lesson out from under them.
 *
 * The window is `settings.checkoutHoldMinutes`, which an administrator sets
 * like every other booking rule, falling back to `CHECKOUT_HOLD.minutes`.
 */
export function holdExpiresAt(booking, payment, settings) {
  const createdAt = new Date(booking.createdAt ?? booking.startAt);
  const ours = new Date(createdAt.getTime() + holdMinutes(settings) * 60_000);

  const providerExpiry = payment?.checkoutExpiresAt ? new Date(payment.checkoutExpiresAt) : null;
  if (!providerExpiry || Number.isNaN(providerExpiry.getTime())) return ours;

  // The grace belongs here and only here: it is what keeps the sweep from
  // racing the provider's own clock. Our window needs none — it is measured
  // from a timestamp we wrote ourselves.
  const theirs = new Date(providerExpiry.getTime() + CHECKOUT_HOLD.graceMinutes * 60_000);
  return theirs > ours ? theirs : ours;
}

/**
 * Payment states in which the money is in hand, or on its way. A booking
 * backed by one of these is never released, whatever its age.
 *
 * Exported because it is also what "already settled" means to
 * `markPaymentPaid`: a late duplicate of the event that settled a payment
 * must not walk a refund off the record. One list, two readers.
 */
export const SETTLED_PAYMENT_STATUSES = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_STATUS.REFUNDED,
];

/**
 * Should this unpaid booking give its slot back?
 *
 * Deliberately conservative — every "no" below is a case where releasing the
 * slot would either destroy a paid lesson or steal one from a purchaser who
 * is still mid-checkout.
 *
 * @returns {{ expire: boolean, reason: string }}
 */
/** The configured hold window, in minutes, with the shipped default beneath it. */
export function holdMinutes(settings) {
  const configured = settings?.checkoutHoldMinutes;
  return Number.isFinite(configured) ? configured : CHECKOUT_HOLD.minutes;
}

export function shouldReleaseHold({ booking, payment, settings, now = new Date() }) {
  if (booking.status !== BOOKING_STATUS.PENDING_PAYMENT) {
    return { expire: false, reason: "not awaiting payment" };
  }
  if (payment && SETTLED_PAYMENT_STATUSES.includes(payment.status)) {
    return { expire: false, reason: "payment settled" };
  }
  if (now < holdExpiresAt(booking, payment, settings)) {
    return { expire: false, reason: "hold is still live" };
  }
  return { expire: true, reason: payment ? "checkout abandoned" : "payment never started" };
}

/**
 * Whether a *verified provider failure* should release the slot at once,
 * rather than waiting for the hold to lapse.
 *
 * The distinction is whether the purchaser still has a way to pay. A card
 * declined inside a live hosted session is a typo, not an abandonment — the
 * same page is still open and the next card works — so the slot stays held
 * and the sweep collects it if they walk away. Once the session is gone there
 * is nothing left to retry through, and holding the slot serves nobody.
 *
 * `checkout.session.expired` passes `sessionEnded` because the provider has
 * already told us that session is dead.
 */
export function failureReleasesHold({ payment, sessionEnded = false, now = new Date() }) {
  if (payment && SETTLED_PAYMENT_STATUSES.includes(payment.status)) return false;
  if (sessionEnded) return true;

  const expiresAt = payment?.checkoutExpiresAt ? new Date(payment.checkoutExpiresAt) : null;
  const sessionStillLive =
    Boolean(payment?.providerCheckoutUrl) &&
    Boolean(expiresAt) &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt > now;

  return !sessionStillLive;
}

/** Can this booking still be cancelled by this actor? */
export function canCancel(booking, actorRole) {
  if (CANCELLED_STATUSES.includes(booking.status)) return false;
  if (booking.status === BOOKING_STATUS.COMPLETED) return false;
  // An expired hold is terminal: the slot is already back on the calendar and
  // there is nothing left to cancel or refund.
  if (booking.status === BOOKING_STATUS.EXPIRED) return false;
  if (booking.status?.startsWith("NO_SHOW")) return false;
  if (new Date(booking.startAt) <= new Date()) return false;
  return ["STUDENT", "TUTOR", "ADMIN", "PARENT"].includes(actorRole);
}

/** A lesson can be marked complete once it has finished. */
export function canComplete(booking) {
  return (
    booking.status === BOOKING_STATUS.CONFIRMED && new Date(booking.endAt) <= new Date()
  );
}

/** Reviews require a completed lesson and no existing review (§23, §42). */
export function canReview(booking) {
  return booking.status === BOOKING_STATUS.COMPLETED && !booking.reviewId;
}

// --- No-shows, disputes and lessons nobody marked (S2, S4, R22.2, R27.5) ---

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function configured(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Hours after a lesson ends during which a no-show may still be reported. */
export function noShowWindowHours(settings) {
  return configured(settings?.noShowReportWindowHours, DEFAULT_SETTINGS.noShowReportWindowHours);
}

/** The moment the no-show window on this lesson closes. */
export function noShowWindowEndsAt(booking, settings) {
  return new Date(new Date(booking.endAt).getTime() + noShowWindowHours(settings) * HOUR_MS);
}

/**
 * Whether a no-show may be reported on this lesson now (S2, R27.5).
 *
 * Only a CONFIRMED lesson that has ended and is still inside the window. A
 * COMPLETED lesson was settled as having happened — by the tutor, or by the
 * `lesson-completion` job once this same window closed — and a lesson that is
 * paid out, cancelled, unpaid or already reported has had its money decided.
 * Re-opening any of those through a no-show is what let a learner refund a
 * lesson months after the tutor was paid; that route is a dispute now, and
 * disputes have their own window and an administrator in the loop.
 *
 * `enforceWindow: false` is for an administrator recording an outcome after
 * the fact — the adjudication path — and nothing else.
 *
 * @returns {{ ok: boolean, code?: string, message?: string, closesAt: Date }}
 */
export function noShowReportEligibility(booking, { settings, now = new Date(), enforceWindow = true } = {}) {
  const closesAt = noShowWindowEndsAt(booking, settings);
  const refuse = (code, message) => ({ ok: false, code, message, closesAt });

  if (booking.status === BOOKING_STATUS.COMPLETED) {
    return refuse(
      "ALREADY_COMPLETED",
      "This lesson has already been completed. If something went wrong, report a problem instead.",
    );
  }
  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    return refuse("NOT_REPORTABLE", "This lesson is no longer open to a no-show report.");
  }
  if (booking.payoutId) {
    return refuse("ALREADY_PAID_OUT", "This lesson has already been paid out. Report a problem instead.");
  }
  if (new Date(booking.endAt) > now) {
    return refuse("TOO_EARLY", "You can report a no-show once the lesson has finished.");
  }
  if (enforceWindow && now > closesAt) {
    return refuse(
      "WINDOW_CLOSED",
      `No-shows can be reported for ${noShowWindowHours(settings)} hours after a lesson ends. Report a problem instead.`,
    );
  }
  return { ok: true, closesAt };
}

/**
 * Before this instant, an ended CONFIRMED lesson is still inside its no-show
 * window and must be left alone; at or after it, the `lesson-completion` job
 * settles it as COMPLETED (R22.2). One window, two readers — the report and
 * the job can never disagree about whether a lesson was still reportable.
 */
export function lessonCompletionCutoff(settings, now = new Date()) {
  return new Date(now.getTime() - noShowWindowHours(settings) * HOUR_MS);
}

/** Lessons a dispute may be raised against (S4, R27.6). */
export const DISPUTABLE_BOOKING_STATUSES = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.NO_SHOW_STUDENT,
  BOOKING_STATUS.NO_SHOW_TUTOR,
];

/** Days after a lesson ends during which a dispute may still be opened. */
export function disputeWindowDays(settings) {
  return configured(settings?.disputeWindowDays, DEFAULT_SETTINGS.disputeWindowDays);
}

/**
 * Whether a dispute may be opened on this lesson now (S4, R27.6).
 *
 * The lesson must have ended, be in one of the outcomes a dispute can change,
 * be inside the dispute window, and have actually been paid for. An unpaid,
 * cancelled or expired booking has no lesson to argue about — and a dispute
 * on one used to be resolved by rewriting it as COMPLETED.
 *
 * @param {object} booking
 * @param {object} options
 * @param {object} [options.payment]  The booking's payment, when it has one.
 */
export function disputeEligibility(booking, { settings, payment, now = new Date() } = {}) {
  const refuse = (code, message) => ({ ok: false, code, message });

  if (new Date(booking.endAt) > now) {
    return refuse("TOO_EARLY", "You can open a dispute once the lesson has finished.");
  }
  if (!DISPUTABLE_BOOKING_STATUSES.includes(booking.status)) {
    return refuse("NOT_DISPUTABLE", "This lesson cannot be disputed.");
  }
  const closesAt = new Date(new Date(booking.endAt).getTime() + disputeWindowDays(settings) * DAY_MS);
  if (now > closesAt) {
    return refuse(
      "WINDOW_CLOSED",
      `Disputes can be opened for ${disputeWindowDays(settings)} days after a lesson. Contact support instead.`,
    );
  }
  const paid =
    Boolean(booking.packagePurchaseId) ||
    Boolean(payment && SETTLED_PAYMENT_STATUSES.includes(payment.status));
  if (!paid) return refuse("NOT_PAID", "This lesson was never paid for, so there is nothing to dispute.");

  return { ok: true, closesAt };
}

/**
 * What a decided dispute leaves the lesson as (S4, R27.6).
 *
 * The default is the status the dispute interrupted: a dispute that changes
 * nothing about what happened must not rewrite it, and a partial refund keeps
 * the lesson's real status — the refund is recorded on the booking instead,
 * where the payout nets it. Only two decisions change the outcome:
 *
 *   • an upheld tutor no-show is a tutor no-show, whatever money was left;
 *   • a full refund for anything else leaves nothing of the lesson that was
 *     paid for, which is a cancellation.
 *
 * A legacy dispute opened before `preDisputeStatus` was recorded falls back
 * on the money: paid becomes COMPLETED, unpaid never does.
 */
export function disputeOutcomeStatus({ reason, resolution, preDisputeStatus, fullyRefunded, paid }) {
  if (resolution === "RESOLVED_REFUND" && reason === DISPUTE_REASONS.TUTOR_NO_SHOW) {
    return BOOKING_STATUS.NO_SHOW_TUTOR;
  }
  if (resolution === "RESOLVED_REFUND" && fullyRefunded) return BOOKING_STATUS.CANCELLED_BY_ADMIN;
  if (preDisputeStatus && preDisputeStatus !== BOOKING_STATUS.DISPUTED) return preDisputeStatus;
  return paid ? BOOKING_STATUS.COMPLETED : BOOKING_STATUS.CANCELLED_BY_ADMIN;
}

/**
 * Repeated no-shows (R27.7, R27.8). The same shape and the same two steps as
 * `assessCancellationAbuse` — a warning at the threshold, an administrator's
 * review at twice it — measured against the risk settings an operator
 * already uses for the no-show signal, so the warning and the signal fire
 * at the same count.
 */
export function assessNoShowAbuse(recentNoShows, settings) {
  const threshold = configured(settings?.risk?.noShowThreshold, DEFAULT_SETTINGS.risk.noShowThreshold);
  const windowDays = configured(settings?.risk?.signalWindowDays, DEFAULT_SETTINGS.risk.signalWindowDays);

  if (recentNoShows < threshold) return { action: "NONE", recentNoShows };
  if (recentNoShows < threshold * 2) {
    return {
      action: "WARN",
      recentNoShows,
      message: `${recentNoShows} lessons have been missed in the last ${windowDays} days. Repeatedly missing lessons may lead to your account being restricted.`,
    };
  }
  return {
    action: "REVIEW",
    recentNoShows,
    message: `${recentNoShows} lessons have been missed in the last ${windowDays} days, and this account needs an administrator's review.`,
  };
}

// --- What a tutor is owed (R16.4, R16.9) ------------------------------------

/**
 * Lessons whose tutor share is earned.
 *
 * A completed lesson, a lesson the student missed (the tutor turned up), and
 * a late student cancellation the policy only partly refunded — in each the
 * platform kept money for the tutor's time, and `netTutorEarnings` pays the
 * tutor their share of exactly what was kept. A lesson refunded in full nets
 * to nothing on its own, so no separate exclusion is needed for it.
 */
export function earningBookingMatch() {
  return {
    $or: [
      { status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.NO_SHOW_STUDENT] } },
      {
        status: BOOKING_STATUS.CANCELLED_BY_STUDENT,
        "cancellation.policyApplied": POLICY.LATE_CANCELLATION,
      },
    ],
  };
}

/** The same lessons, once their payout hold has passed. */
export function payableBookingMatch(holdCutoff) {
  return {
    $or: [
      {
        status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.NO_SHOW_STUDENT] },
        completedAt: { $lte: holdCutoff },
      },
      {
        status: BOOKING_STATUS.CANCELLED_BY_STUDENT,
        "cancellation.policyApplied": POLICY.LATE_CANCELLATION,
        "cancellation.cancelledAt": { $lte: holdCutoff },
      },
    ],
  };
}

/**
 * Repeated-cancellation abuse (§26). Returns the action the platform should
 * take given how many times this user has cancelled recently.
 */
export function assessCancellationAbuse(recentCancellations, settings) {
  const threshold = settings.cancellationAbuseThreshold;
  if (recentCancellations < threshold) return { action: "NONE", recentCancellations };
  if (recentCancellations < threshold * 2) {
    return {
      action: "WARN",
      recentCancellations,
      message: `You have cancelled ${recentCancellations} lessons in the last ${settings.cancellationAbuseWindowDays} days. Repeated cancellations may lead to your account being restricted.`,
    };
  }
  return {
    action: "REVIEW",
    recentCancellations,
    message: `This account has cancelled ${recentCancellations} lessons in the last ${settings.cancellationAbuseWindowDays} days and needs an administrator's review.`,
  };
}
