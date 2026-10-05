import { AGE_RULES } from "@/constants/config";

/**
 * Ages from a birth year (§3, §30).
 *
 * Only a year is stored, so the age is the larger of the two it could be
 * this year minus one — someone born in 2008 may still be 17 on 1 October
 * 2026, and treating them as 18 would release a minor's surname. Every
 * caller that needs "is this learner a minor" goes through here.
 */
export function minimumAgeFromBirthYear(birthYear, now = new Date()) {
  if (!Number.isInteger(birthYear)) return null;
  return now.getFullYear() - birthYear - 1;
}

/** Unknown age counts as a minor: privacy fails closed. */
export function isMinorByBirthYear(birthYear, now = new Date()) {
  const age = minimumAgeFromBirthYear(birthYear, now);
  return age === null ? true : age < AGE_RULES.adultAge;
}

/**
 * The latest birth year a self-registering student may give — the same
 * conservative year arithmetic, so nobody who might be under the minimum
 * passes it.
 */
export function latestStudentBirthYear(now = new Date()) {
  return now.getFullYear() - AGE_RULES.minimumStudentAge - 1;
}
