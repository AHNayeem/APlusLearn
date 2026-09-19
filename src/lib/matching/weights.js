/**
 * Matching factor weights (§22, §41 Phase 2).
 *
 * One object, one place. Every factor the scorer knows about appears here
 * exactly once, which is what lets a new factor be added without touching the
 * scoring loop — and what lets an operator retune the marketplace from the
 * admin console without a deployment.
 *
 * Weights are *relative*, not absolute: `normaliseWeights` rescales whatever
 * it is given so the total is always 100. That keeps every score on the same
 * 0–100 ruler however an operator has edited the numbers, so a score stored
 * last month and a score computed today mean the same thing to a reader.
 *
 * The shipped values are a starting point, not a business rule — §41 names
 * "advanced matching" without specifying factors or weights, so the numbers
 * live in platform settings where an operator owns them.
 */

export const MATCH_FACTORS = {
  COURSE: "course",
  LOCATION: "location",
  BUDGET: "budget",
  AVAILABILITY: "availability",
  QUALITY: "quality",
  LANGUAGE: "language",
  VERIFICATION: "verification",
  EXPERIENCE: "experience",
  RESPONSIVENESS: "responsiveness",
  RELIABILITY: "reliability",
};

/** Shipped defaults. Sum to 100 so an untouched install needs no rescaling. */
export const MATCH_WEIGHTS = {
  [MATCH_FACTORS.COURSE]: 30,
  [MATCH_FACTORS.LOCATION]: 14,
  [MATCH_FACTORS.BUDGET]: 14,
  [MATCH_FACTORS.AVAILABILITY]: 14,
  [MATCH_FACTORS.QUALITY]: 10,
  [MATCH_FACTORS.LANGUAGE]: 5,
  [MATCH_FACTORS.VERIFICATION]: 5,
  [MATCH_FACTORS.EXPERIENCE]: 4,
  [MATCH_FACTORS.RESPONSIVENESS]: 2,
  [MATCH_FACTORS.RELIABILITY]: 2,
};

export const MATCH_FACTOR_LABELS = {
  [MATCH_FACTORS.COURSE]: "Course fit",
  [MATCH_FACTORS.LOCATION]: "Location and lesson type",
  [MATCH_FACTORS.BUDGET]: "Budget fit",
  [MATCH_FACTORS.AVAILABILITY]: "Schedule fit",
  [MATCH_FACTORS.QUALITY]: "Reviews",
  [MATCH_FACTORS.LANGUAGE]: "Language",
  [MATCH_FACTORS.VERIFICATION]: "Verification",
  [MATCH_FACTORS.EXPERIENCE]: "Experience",
  [MATCH_FACTORS.RESPONSIVENESS]: "Reply speed",
  [MATCH_FACTORS.RELIABILITY]: "Reliability",
};

export const MATCH_FACTOR_HINTS = {
  [MATCH_FACTORS.COURSE]: "Teaches the exact course, or the same subject at a close grade.",
  [MATCH_FACTORS.LOCATION]: "Offers the lesson type asked for, and is close enough to travel.",
  [MATCH_FACTORS.BUDGET]: "Hourly rate sits inside the family's stated budget.",
  [MATCH_FACTORS.AVAILABILITY]: "Free during the windows the family asked for.",
  [MATCH_FACTORS.QUALITY]: "Review score, weighted by how many reviews there are.",
  [MATCH_FACTORS.LANGUAGE]: "Speaks a language the family asked for.",
  [MATCH_FACTORS.VERIFICATION]: "Identity, credentials and background checks confirmed.",
  [MATCH_FACTORS.EXPERIENCE]: "Years of teaching experience against what was asked for.",
  [MATCH_FACTORS.RESPONSIVENESS]: "How quickly this tutor replies to messages.",
  [MATCH_FACTORS.RELIABILITY]: "Lessons completed against lessons cancelled.",
};

export const MATCH_FACTOR_KEYS = Object.values(MATCH_FACTORS);

/**
 * Rescale a partial or mis-summed weight map onto a total of 100.
 *
 * Unknown keys are dropped and missing ones fall back to the shipped default,
 * so a settings document written by an older build — or by an operator who
 * edited three of the ten — still produces a complete, comparable score.
 */
export function normaliseWeights(weights) {
  const merged = {};
  for (const key of MATCH_FACTOR_KEYS) {
    const value = Number(weights?.[key]);
    merged[key] = Number.isFinite(value) && value >= 0 ? value : MATCH_WEIGHTS[key];
  }

  const total = Object.values(merged).reduce((sum, v) => sum + v, 0);
  if (total <= 0) return { ...MATCH_WEIGHTS };

  return Object.fromEntries(
    MATCH_FACTOR_KEYS.map((key) => [key, (merged[key] / total) * 100]),
  );
}
