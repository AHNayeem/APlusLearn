import { AVAILABILITY_WINDOWS, LESSON_MODES, VERIFICATION_TYPES } from "@/constants";
import { matchesAvailabilityWindow } from "@/lib/booking/slots";
import {
  MATCH_FACTORS,
  MATCH_FACTOR_KEYS,
  MATCH_FACTOR_LABELS,
  MATCH_WEIGHTS,
  normaliseWeights,
} from "./weights";
import { pairDistanceKm } from "./eligibility";

export { MATCH_WEIGHTS, MATCH_FACTORS, MATCH_FACTOR_KEYS, MATCH_FACTOR_LABELS };

/**
 * Tutor/request scoring (§22, §41 Phase 2).
 *
 * Every factor is a pure function of stored data returning 0–1; the weighted
 * sum is the 0–100 score. The loop below never names a factor, so adding one
 * means adding a scorer and a weight — nothing else changes, and nothing in
 * the UI computes a score of its own.
 *
 * Scores are deterministic: the same tutor, request and availability always
 * produce the same number, which is what makes a stored `scoreBreakdown`
 * meaningful weeks later and what makes the ordering testable.
 */

const FACTOR_SCORERS = {
  [MATCH_FACTORS.COURSE]: scoreCourse,
  [MATCH_FACTORS.LOCATION]: scoreLocation,
  [MATCH_FACTORS.BUDGET]: scoreBudget,
  [MATCH_FACTORS.AVAILABILITY]: scoreAvailability,
  [MATCH_FACTORS.QUALITY]: scoreQuality,
  [MATCH_FACTORS.LANGUAGE]: scoreLanguage,
  [MATCH_FACTORS.VERIFICATION]: scoreVerification,
  [MATCH_FACTORS.EXPERIENCE]: scoreExperience,
  [MATCH_FACTORS.RESPONSIVENESS]: scoreResponsiveness,
  [MATCH_FACTORS.RELIABILITY]: scoreReliability,
};

/**
 * Score one tutor against one request.
 *
 * @param {object} tutor         TutorProfile (lean).
 * @param {object} request       TutorRequest (lean).
 * @param {object} [availability] The tutor's Availability document.
 * @param {object} [weights]     Operator weights; defaults to the shipped set.
 * @returns {{ score: number, breakdown: object, factors: object, distanceKm: number|null }}
 *   `breakdown` holds each factor's *points*, which is what gets stored and
 *   rendered; `factors` holds the raw 0–1 fit, which is what explains it.
 */
export function scoreTutorForRequest(tutor, request, availability, weights) {
  const w = normaliseWeights(weights ?? MATCH_WEIGHTS);
  const context = { tutor, request, availability };

  const factors = {};
  const breakdown = {};
  let total = 0;

  for (const key of MATCH_FACTOR_KEYS) {
    const fit = clamp01(FACTOR_SCORERS[key](context));
    const points = fit * w[key];
    factors[key] = Math.round(fit * 100) / 100;
    breakdown[key] = Math.round(points * 10) / 10;
    total += points;
  }

  return {
    score: Math.round(total),
    breakdown,
    factors,
    weights: w,
    distanceKm: pairDistanceKm(tutor, request),
  };
}

/**
 * Stable ordering for a scored list.
 *
 * Ties are broken by things a tutor earns rather than by insertion order, and
 * the final fall-back is the profile id — so the same candidate set always
 * comes back in the same order, whatever order the database returned it in.
 */
export function compareMatches(a, b) {
  if (b.score !== a.score) return b.score - a.score;

  const ratingA = a.tutor?.stats?.ratingAverage ?? 0;
  const ratingB = b.tutor?.stats?.ratingAverage ?? 0;
  if (ratingB !== ratingA) return ratingB - ratingA;

  const lessonsA = a.tutor?.stats?.completedLessons ?? 0;
  const lessonsB = b.tutor?.stats?.completedLessons ?? 0;
  if (lessonsB !== lessonsA) return lessonsB - lessonsA;

  return String(a.tutor?._id ?? "").localeCompare(String(b.tutor?._id ?? ""));
}

// --- Factors ---------------------------------------------------------------

/** Exact course match is the whole point; subject-only is a weak fallback. */
function scoreCourse({ tutor, request }) {
  const teachesCourse = (tutor.courseIds ?? []).some(
    (id) => String(id) === String(request.courseId),
  );
  if (teachesCourse) return 1;

  const sameSubject = (tutor.subjectIds ?? []).some(
    (id) => String(id) === String(request.subjectId),
  );
  if (!sameSubject) return 0;

  // Same subject, and close enough in grade to be plausible.
  const levels = tutor.gradeLevels?.length ? tutor.gradeLevels : [99];
  const gradeGap = Math.min(...levels.map((level) => Math.abs(level - (request.gradeLevel ?? 0))));
  if (gradeGap === 0) return 0.7;
  return gradeGap <= 1 ? 0.5 : 0.25;
}

function scoreLocation({ tutor, request }) {
  const wantsOnline = request.modes?.includes(LESSON_MODES.ONLINE);
  const wantsInPerson = request.modes?.includes(LESSON_MODES.IN_PERSON);

  const offersOnline = tutor.lessonModes?.includes(LESSON_MODES.ONLINE);
  const offersInPerson = tutor.lessonModes?.includes(LESSON_MODES.IN_PERSON);

  // Online-only requests are location-independent.
  if (wantsOnline && !wantsInPerson) return offersOnline ? 1 : 0;

  if (wantsInPerson && offersInPerson) {
    const km = pairDistanceKm(tutor, request);
    if (km === null) {
      // No coordinates either side — fall back to a city name comparison.
      return tutor.city && request.city && tutor.city.toLowerCase() === request.city.toLowerCase()
        ? 0.8
        : 0.3;
    }
    const limit = Math.min(request.maxDistanceKm ?? 25, tutor.travelRadiusKm ?? 15);
    if (limit <= 0) return 0;
    if (km <= limit) return 1 - (km / limit) * 0.3; // nearer is better
    if (km <= limit * 1.5) return 0.4;
    return 0;
  }

  // The family would also accept online, and the tutor offers it.
  if (wantsOnline && offersOnline) return 0.7;
  return 0;
}

function scoreBudget({ tutor, request }) {
  const rate = tutor.minHourlyRateCents ?? tutor.hourlyRateCents;
  const max = request.budgetMaxCents;
  if (!max || !rate) return 0.5;

  if (rate <= max) {
    const min = request.budgetMinCents ?? 0;
    if (rate >= min) return 1;
    return 0.9; // below the stated minimum — still fine, mildly suspicious
  }

  // Slightly over budget is worth surfacing; far over is not.
  const overBy = (rate - max) / max;
  if (overBy <= 0.1) return 0.6;
  if (overBy <= 0.25) return 0.25;
  return 0;
}

/**
 * Schedule fit.
 *
 * Named windows are the coarse signal the family gave us. When they also gave
 * a weekly cadence, a tutor who publishes far less availability than the
 * lessons asked for is discounted — the windows can overlap and the tutor
 * still not have the hours.
 */
function scoreAvailability({ availability, request }) {
  if (!availability?.weeklyRules?.length) return 0;

  const wanted = AVAILABILITY_WINDOWS.filter((w) =>
    (request.preferredWindows ?? []).includes(w.value),
  );

  const windowFit = wanted.length
    ? wanted.filter((w) => matchesAvailabilityWindow(availability, w)).length / wanted.length
    : 0.5;

  const weeklyMinutes = availability.weeklyRules.reduce(
    (sum, rule) => sum + Math.max(0, rule.endMinutes - rule.startMinutes),
    0,
  );
  const neededMinutes =
    (request.sessionsPerWeek ?? 1) * (request.preferredDurationMinutes ?? 60);
  // Published hours are shared across every student, so "enough" means
  // comfortably more than one family's worth, not exactly it.
  const capacityFit = clamp01(weeklyMinutes / Math.max(neededMinutes * 3, 1));

  return windowFit * 0.75 + capacityFit * 0.25;
}

function scoreQuality({ tutor }) {
  const rating = tutor.stats?.ratingAverage ?? 0;
  const count = tutor.stats?.ratingCount ?? 0;
  if (!count) return 0.4; // new tutors are not penalised into invisibility
  const ratingScore = Math.min(rating / 5, 1);
  const confidence = Math.min(count / 10, 1);
  return ratingScore * 0.7 + confidence * 0.3;
}

/**
 * Language.
 *
 * Neutral when the family did not ask, so a request with no preference is
 * scored on the other factors rather than on an accident of what tutors list.
 */
function scoreLanguage({ tutor, request }) {
  const wanted = (request.languages ?? []).filter(Boolean);
  if (!wanted.length) return 0.5;

  const spoken = new Set((tutor.languages ?? []).map((l) => String(l).toLowerCase()));
  const hits = wanted.filter((l) => spoken.has(String(l).toLowerCase())).length;
  return hits / wanted.length;
}

/** Badges a moderator granted, never anything a tutor set on themselves. */
const VERIFICATION_VALUE = {
  [VERIFICATION_TYPES.IDENTITY]: 0.4,
  [VERIFICATION_TYPES.BACKGROUND_CHECK]: 0.3,
  [VERIFICATION_TYPES.OCT]: 0.15,
  [VERIFICATION_TYPES.EDUCATION]: 0.1,
  [VERIFICATION_TYPES.UNIVERSITY_STUDENT]: 0.05,
};

function scoreVerification({ tutor }) {
  const types = new Set(tutor.verifiedTypes ?? []);
  let value = 0;
  for (const [type, weight] of Object.entries(VERIFICATION_VALUE)) {
    if (types.has(type)) value += weight;
  }
  return value;
}

function scoreExperience({ tutor, request }) {
  const years = tutor.yearsExperience ?? 0;
  const wanted = request.minYearsExperience ?? 0;

  if (wanted > 0) return years >= wanted ? 1 : clamp01(years / wanted) * 0.6;
  // No stated preference: more experience is mildly better, saturating at 10.
  return clamp01(years / 10);
}

function scoreResponsiveness({ tutor }) {
  const minutes = tutor.stats?.responseTimeMinutes;
  if (minutes == null) return 0.5; // unknown is not a penalty
  if (minutes <= 60) return 1;
  if (minutes >= 48 * 60) return 0;
  return 1 - (minutes - 60) / (48 * 60 - 60);
}

function scoreReliability({ tutor }) {
  const completed = tutor.stats?.completedLessons ?? 0;
  const cancelled = tutor.stats?.cancellationCount ?? 0;
  const total = completed + cancelled;
  if (total < 3) return 0.6; // too little history to judge either way
  return clamp01(completed / total);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// --- Explanation -----------------------------------------------------------

/**
 * Explain a score in plain language for the comparison view.
 *
 * Reads the stored *points* against the weights that produced them, so a
 * match scored before an operator retuned the weights still explains itself
 * correctly rather than against today's numbers.
 */
export function explainMatch(breakdown = {}, distanceKm, weights) {
  const w = normaliseWeights(weights ?? MATCH_WEIGHTS);
  const at = (key, ratio) => (breakdown[key] ?? 0) >= w[key] * ratio && w[key] > 0;

  const reasons = [];

  if (at(MATCH_FACTORS.COURSE, 0.99)) reasons.push("Teaches this exact course");
  else if ((breakdown[MATCH_FACTORS.COURSE] ?? 0) > 0) {
    reasons.push("Teaches this subject at a similar level");
  }

  if (at(MATCH_FACTORS.LOCATION, 0.8)) {
    reasons.push(distanceKm != null ? `About ${Math.round(distanceKm)} km away` : "Available online");
  }
  if (at(MATCH_FACTORS.BUDGET, 0.99)) reasons.push("Within your budget");
  if (at(MATCH_FACTORS.AVAILABILITY, 0.8)) reasons.push("Free when you need lessons");
  if (at(MATCH_FACTORS.LANGUAGE, 0.99)) reasons.push("Speaks the language you asked for");
  if (at(MATCH_FACTORS.VERIFICATION, 0.7)) reasons.push("Identity and background checked");
  if (at(MATCH_FACTORS.EXPERIENCE, 0.9)) reasons.push("Experienced in this subject");
  if (at(MATCH_FACTORS.RESPONSIVENESS, 0.9)) reasons.push("Replies quickly");
  if (at(MATCH_FACTORS.RELIABILITY, 0.9)) reasons.push("Strong record of lessons taught");

  return reasons;
}
