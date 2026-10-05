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

/**
 * The tutor's share of what the platform actually kept for a booking.
 *
 * `price.tutorEarningsCents` is the share of the *list* price. Once part of
 * that price is refunded — a dispute settled for half, a late cancellation's
 * partial refund, a no-show — the tutor is owed the same proportion of what
 * remains, never the full share of money that went back to the family
 * (audit S3/R16.4). Rounded down, so the platform never pays out a fraction
 * of a cent it did not keep.
 */
export function netTutorEarnings(price, refundedCents = 0) {
  const total = price?.totalCents ?? 0;
  const share = price?.tutorEarningsCents ?? 0;
  if (total <= 0 || share <= 0) return 0;
  const kept = Math.min(total, Math.max(0, total - (refundedCents ?? 0)));
  return Math.floor((share * kept) / total);
}

/**
 * `netTutorEarnings` as a MongoDB aggregation expression over a booking
 * document, so a report summed in the database applies the identical rule.
 */
export function netTutorEarningsExpression(prefix = "$") {
  const total = `${prefix}price.totalCents`;
  const share = `${prefix}price.tutorEarningsCents`;
  const refunded = { $ifNull: [`${prefix}refundedCents`, 0] };
  return {
    $cond: [
      { $gt: [total, 0] },
      {
        $floor: {
          $divide: [
            { $multiply: [share, { $min: [total, { $max: [0, { $subtract: [total, refunded] }] }] }] },
            total,
          ],
        },
      },
      0,
    ],
  };
}
