import { BOOKING_STATUS, CANCELLED_STATUSES, PAYMENT_STATUS, CHECKOUT_HOLD } from "@/constants";
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
 */
const SETTLED_PAYMENT_STATUSES = [
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
