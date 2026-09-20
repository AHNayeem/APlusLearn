/**
 * Analytics reporting periods (§25, §41 Phase 2).
 *
 * Pure, so the boundary arithmetic that every aggregation depends on can be
 * tested without a database or a clock.
 *
 * Two problems this exists to solve, both of which quietly corrupt a report
 * when they are left to each call site:
 *
 *   **Boundaries.** A period is half-open: `from` inclusive, `to` exclusive.
 *   A closed-closed range double-counts anything that lands exactly on a
 *   boundary when two adjacent periods are compared, which is precisely what
 *   a "vs. previous period" figure does.
 *
 *   **Time zone.** A Canadian marketplace's "today" is not UTC's. Bucketing
 *   by UTC day puts an 8pm Toronto lesson into tomorrow for five months of
 *   the year and into the right day for the other seven, which makes a daily
 *   chart wrong in a way nobody notices until March. Every `$dateToString`
 *   in the aggregations takes the zone resolved here.
 */

/** Where the marketplace lives, and therefore what a "day" means (§1). */
export const DEFAULT_REPORTING_TIME_ZONE = "America/Toronto";

/** Longest period a single report may cover. */
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86400000;

/**
 * Resolve a reporting period.
 *
 * Accepts either a rolling window (`days`) or explicit instants
 * (`from`/`to`). Explicit dates win when both are given, because somebody who
 * typed a date meant it.
 *
 * @returns {{from: Date, to: Date, days: number, timeZone: string,
 *            previous: {from: Date, to: Date}, granularity: "day"|"week"|"month"}}
 */
export function resolveRange({ from, to, days, timeZone, now = new Date() } = {}) {
  const zone = isUsableTimeZone(timeZone) ? timeZone : DEFAULT_REPORTING_TIME_ZONE;

  let end = to ? new Date(to) : new Date(now);
  let start = from ? new Date(from) : null;

  if (Number.isNaN(end.getTime())) end = new Date(now);

  if (!start || Number.isNaN(start.getTime())) {
    const window = clampDays(days ?? 30);
    start = new Date(end.getTime() - window * DAY_MS);
  }

  // A backwards range is a typo, not an instruction to report nothing.
  if (start > end) [start, end] = [end, start];

  // Cap the span rather than refusing it: an aggregation over five years of
  // bookings is a slow query somebody asked for by accident.
  const spanDays = Math.max(1, Math.round((end - start) / DAY_MS));
  if (spanDays > MAX_RANGE_DAYS) {
    start = new Date(end.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }

  const span = end - start;

  return {
    from: start,
    to: end,
    days: Math.max(1, Math.round(span / DAY_MS)),
    timeZone: zone,
    /** The immediately preceding window of equal length, for trend figures. */
    previous: { from: new Date(start.getTime() - span), to: start },
    granularity: granularityFor(span),
  };
}

/**
 * How finely to bucket a time series.
 *
 * A twelve-month report drawn as 365 daily bars is unreadable and is 365
 * documents the browser did not need; a seven-day report drawn as one monthly
 * bar says nothing at all.
 */
export function granularityFor(spanMs) {
  const days = spanMs / DAY_MS;
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  return "month";
}

/** The `$dateToString` format matching a granularity. */
export const BUCKET_FORMAT = {
  day: "%Y-%m-%d",
  week: "%G-W%V",
  month: "%Y-%m",
};

/**
 * A half-open `$match` fragment for a date field.
 *
 * `$gte`/`$lt` rather than `$gte`/`$lte`: the exclusive upper bound is what
 * makes two adjacent periods partition the timeline instead of overlapping
 * on one instant.
 */
export function dateWindow(field, { from, to }) {
  return { [field]: { $gte: from, $lt: to } };
}

/** The bucketing expression every time series in the service shares. */
export function bucketExpression(field, { granularity, timeZone }) {
  return {
    $dateToString: {
      format: BUCKET_FORMAT[granularity] ?? BUCKET_FORMAT.day,
      date: `$${field}`,
      timezone: timeZone,
    },
  };
}

/**
 * Percentage change between two periods.
 *
 * "No baseline" is reported as null rather than as 100%, because a jump from
 * nothing to something is not a percentage and printing one invites a reader
 * to compare it with a real figure.
 */
export function percentChange(current, previous) {
  if (!previous) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** A rate as a whole percentage, safe when the denominator is zero. */
export function rate(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

function clampDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(Math.round(n), MAX_RANGE_DAYS);
}

/** A zone MongoDB would reject is worse than the default it replaced. */
function isUsableTimeZone(zone) {
  if (!zone || typeof zone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
