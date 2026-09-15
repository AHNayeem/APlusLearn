/**
 * Centralised money maths (§20, §42).
 *
 * Every figure is an integer number of cents. The client never supplies a
 * price — it only ever displays what these functions return for a given
 * tutor rate and duration, and the same functions run again at booking time.
 */

/** Rate for a specific course: the per-course override, else the base rate. */
export function rateForCourse(tutorProfile, courseId) {
  const override = tutorProfile?.courses?.find(
    (c) => String(c.courseId) === String(courseId),
  )?.hourlyRateCents;
  return override && override > 0 ? override : tutorProfile.hourlyRateCents;
}

/**
 * Compute one lesson's breakdown.
 *
 * Commission is rounded down to the cent and the tutor receives the
 * remainder, so subtotal always equals commission + earnings exactly.
 */
export function calculateLessonPrice({ hourlyRateCents, durationMinutes, commissionPercent }) {
  const subtotalCents = Math.round((hourlyRateCents * durationMinutes) / 60);
  const commissionCents = Math.floor((subtotalCents * commissionPercent) / 100);
  const tutorEarningsCents = subtotalCents - commissionCents;

  return {
    hourlyRateCents,
    durationMinutes,
    subtotalCents,
    commissionPercent,
    commissionCents,
    tutorEarningsCents,
    // No taxes or booking fees in the MVP; the field exists so adding them
    // later is a change in one place.
    totalCents: subtotalCents,
    currency: "CAD",
  };
}

/** Totals across a recurring series, for the checkout summary. */
export function calculateSeriesTotal(lessonPrice, occurrences) {
  const count = Math.max(1, occurrences);
  return {
    occurrences: count,
    perLessonCents: lessonPrice.totalCents,
    subtotalCents: lessonPrice.subtotalCents * count,
    commissionCents: lessonPrice.commissionCents * count,
    tutorEarningsCents: lessonPrice.tutorEarningsCents * count,
    totalCents: lessonPrice.totalCents * count,
    currency: lessonPrice.currency,
  };
}

/** Refund amount for a percentage of a paid total. */
export function calculateRefund(totalCents, refundPercent) {
  return Math.round((totalCents * refundPercent) / 100);
}

/** What the platform keeps once a refund is issued. */
export function commissionAfterRefund(price, refundCents) {
  if (refundCents <= 0) return price.commissionCents;
  // A full refund voids the commission; a partial refund reduces it pro rata.
  const remaining = Math.max(0, price.totalCents - refundCents);
  return Math.floor((remaining * price.commissionPercent) / 100);
}

export function centsFromDollars(dollars) {
  return Math.round(Number(dollars) * 100);
}

export function dollarsFromCents(cents) {
  return (Number(cents) || 0) / 100;
}
