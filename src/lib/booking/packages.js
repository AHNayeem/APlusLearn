import { calculateLessonPrice } from "./pricing";

/**
 * Package maths (§20, §41 Phase 2).
 *
 * Kept beside `pricing.js` and built on top of it rather than beside it: a
 * package session is priced by exactly the same function as any other lesson,
 * just at the package's own per-session rate. That is what keeps commission,
 * payouts and refunds identical whether a lesson was bought one at a time or
 * in a block — and what stops packages becoming a second pricing system.
 *
 * Every figure is an integer number of cents. The client supplies the block
 * price and nothing else; everything below is derived server-side (§42).
 */

/**
 * Break a package price down into the per-session figures a booking needs.
 *
 * The remainder from dividing the block price by the session count is given
 * to the *first* session rather than dropped, so the sessions always add back
 * up to exactly what was paid. Without that, an eleven-session package at an
 * awkward price quietly loses a few cents, and the refund of a fully unused
 * package would not match the charge.
 */
export function packageBreakdown({ priceCents, sessionCount, durationMinutes, commissionPercent }) {
  const sessions = Math.max(1, Math.trunc(sessionCount));
  const perSessionCents = Math.floor(priceCents / sessions);
  const remainderCents = priceCents - perSessionCents * sessions;

  const perSession = calculateLessonPrice({
    // The hourly rate this package works out to, which is what the lesson
    // pricing function expects.
    hourlyRateCents: hourlyRateFor(perSessionCents, durationMinutes),
    durationMinutes,
    commissionPercent,
  });

  return {
    sessions,
    priceCents,
    perSessionCents,
    remainderCents,
    perSessionCommissionCents: perSession.commissionCents,
    perSessionTutorEarningsCents: perSession.tutorEarningsCents,
    effectiveHourlyRateCents: hourlyRateFor(perSessionCents, durationMinutes),
    commissionPercent,
    currency: perSession.currency,
  };
}

/**
 * The price breakdown to store on a booking drawn from a package.
 *
 * `index` is which session of the block it is, because the first one carries
 * the rounding remainder.
 */
export function packageSessionPrice(purchase, { index = 0 } = {}) {
  const base = purchase.perSessionCents;
  const remainder =
    index === 0
      ? purchase.priceCents - purchase.perSessionCents * purchase.sessionsTotal
      : 0;
  const subtotalCents = base + remainder;

  const commissionCents = Math.floor((subtotalCents * purchase.commissionPercent) / 100);

  return {
    hourlyRateCents: hourlyRateFor(subtotalCents, purchase.sessionDurationMinutes),
    durationMinutes: purchase.sessionDurationMinutes,
    subtotalCents,
    commissionPercent: purchase.commissionPercent,
    commissionCents,
    tutorEarningsCents: subtotalCents - commissionCents,
    totalCents: subtotalCents,
    currency: "CAD",
  };
}

/** What a package's unused lessons are worth, for a refund. */
export function unusedPackageValue(purchase) {
  const remaining = Math.max(0, purchase.sessionsTotal - purchase.sessionsUsed);
  if (remaining <= 0) return 0;

  // Valued at the plain per-session price. The first session's rounding
  // remainder belongs to a lesson that was delivered, so it is not refunded.
  return Math.min(purchase.perSessionCents * remaining, purchase.priceCents - (purchase.refundedCents ?? 0));
}

/**
 * Is this package honest?
 *
 * The one rule the platform imposes on a tutor's own pricing: a block of
 * lessons may not cost more per hour than booking the same lessons one at a
 * time. §41 names packages without pricing them, so the price itself is the
 * tutor's — but a "package" that is a markup is a trap rather than an offer,
 * and the comparison is against the tutor's own published rate rather than
 * any number invented here.
 */
export function assessPackagePrice({ priceCents, sessionCount, durationMinutes, standardHourlyRateCents, settings }) {
  const perSessionCents = Math.floor(priceCents / Math.max(1, sessionCount));
  const effectiveHourlyRateCents = hourlyRateFor(perSessionCents, durationMinutes);

  const floorCents = (settings?.minHourlyRate ?? 0) * 100;
  if (effectiveHourlyRateCents < floorCents) {
    return {
      ok: false,
      code: "BELOW_MINIMUM_RATE",
      message: `That works out to less than the platform minimum of $${settings.minHourlyRate}/hour.`,
      effectiveHourlyRateCents,
    };
  }

  if (standardHourlyRateCents && effectiveHourlyRateCents > standardHourlyRateCents) {
    return {
      ok: false,
      code: "ABOVE_STANDARD_RATE",
      message:
        "A package cannot cost more per hour than booking the same lessons individually. Lower the price, or raise your standard rate.",
      effectiveHourlyRateCents,
    };
  }

  const savingPercent = standardHourlyRateCents
    ? Math.max(
        0,
        Math.round(((standardHourlyRateCents - effectiveHourlyRateCents) / standardHourlyRateCents) * 100),
      )
    : 0;

  return { ok: true, effectiveHourlyRateCents, perSessionCents, savingPercent };
}

function hourlyRateFor(sessionCents, durationMinutes) {
  const minutes = Math.max(1, durationMinutes);
  return Math.round((sessionCents * 60) / minutes);
}
