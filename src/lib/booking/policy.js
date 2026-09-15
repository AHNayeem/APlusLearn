import { BOOKING_STATUS, CANCELLED_STATUSES } from "@/constants";
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
};

export const POLICY_LABELS = {
  FREE_CANCELLATION: "Free cancellation",
  LATE_CANCELLATION: "Late cancellation",
  TUTOR_CANCELLATION: "Cancelled by tutor",
  ADMIN_CANCELLATION: "Cancelled by APlus Learn",
  STUDENT_NO_SHOW: "Student did not attend",
  TUTOR_NO_SHOW: "Tutor did not attend",
};

/**
 * Resolve the refund for a cancellation.
 *
 * @param {object} args
 * @param {Date|string} args.startAt      When the lesson begins.
 * @param {number} args.totalCents        What the student paid.
 * @param {"STUDENT"|"TUTOR"|"ADMIN"} args.cancelledBy
 * @param {object} args.settings          Platform settings (admin-configurable).
 */
export function resolveCancellation({ startAt, totalCents, cancelledBy, settings }) {
  const hoursBeforeStart = hoursUntil(startAt);

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
    "If your tutor cancels or does not attend, you are refunded in full.",
  ];
}

/** Can this booking still be cancelled by this actor? */
export function canCancel(booking, actorRole) {
  if (CANCELLED_STATUSES.includes(booking.status)) return false;
  if (booking.status === BOOKING_STATUS.COMPLETED) return false;
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
