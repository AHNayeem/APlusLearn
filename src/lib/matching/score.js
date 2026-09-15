import { AVAILABILITY_WINDOWS, LESSON_MODES } from "@/constants";
import { distanceKm } from "@/lib/geo";
import { matchesAvailabilityWindow } from "@/lib/booking/slots";

/**
 * Tutor/request matching (§22).
 *
 * MVP factors: course, location, budget, availability — plus a small quality
 * term so equally-suited tutors are ordered sensibly. Weights live in one
 * object so Phase 2 factors (teaching style, repeat-booking rate, response
 * rate) can be added without touching the scoring loop.
 */

export const MATCH_WEIGHTS = {
  course: 40,
  location: 20,
  budget: 20,
  availability: 15,
  quality: 5,
};

export function scoreTutorForRequest(tutor, request, availability) {
  const breakdown = {
    course: scoreCourse(tutor, request),
    location: scoreLocation(tutor, request),
    budget: scoreBudget(tutor, request),
    availability: scoreAvailability(availability, request),
    quality: scoreQuality(tutor),
  };

  const score = Math.round(
    Object.entries(breakdown).reduce(
      (sum, [key, value]) => sum + value * MATCH_WEIGHTS[key],
      0,
    ),
  );

  return {
    score,
    breakdown: Object.fromEntries(
      Object.entries(breakdown).map(([k, v]) => [k, Math.round(v * MATCH_WEIGHTS[k])]),
    ),
    distanceKm: tutorDistance(tutor, request),
  };
}

/** Exact course match is the whole point; subject-only is a weak fallback. */
function scoreCourse(tutor, request) {
  const teachesCourse = (tutor.courseIds ?? []).some(
    (id) => String(id) === String(request.courseId),
  );
  if (teachesCourse) return 1;

  const sameSubject = (tutor.subjectIds ?? []).some(
    (id) => String(id) === String(request.subjectId),
  );
  if (!sameSubject) return 0;

  // Same subject, and close enough in grade to be plausible.
  const gradeGap = Math.min(
    ...(tutor.gradeLevels ?? [99]).map((level) => Math.abs(level - (request.gradeLevel ?? 0))),
  );
  return gradeGap <= 1 ? 0.5 : 0.25;
}

function tutorDistance(tutor, request) {
  const tutorCoords = tutor.location?.coordinates;
  const requestCoords = request.location?.coordinates;
  if (!tutorCoords || !requestCoords) return null;
  return distanceKm(requestCoords, tutorCoords);
}

function scoreLocation(tutor, request) {
  const wantsOnline = request.modes?.includes(LESSON_MODES.ONLINE);
  const wantsInPerson = request.modes?.includes(LESSON_MODES.IN_PERSON);

  const offersOnline = tutor.lessonModes?.includes(LESSON_MODES.ONLINE);
  const offersInPerson = tutor.lessonModes?.includes(LESSON_MODES.IN_PERSON);

  // Online-only requests are location-independent.
  if (wantsOnline && !wantsInPerson) return offersOnline ? 1 : 0;

  if (wantsInPerson && offersInPerson) {
    const km = tutorDistance(tutor, request);
    if (km === null) {
      // No coordinates either side — fall back to a city name comparison.
      return tutor.city && request.city && tutor.city.toLowerCase() === request.city.toLowerCase()
        ? 0.8
        : 0.3;
    }
    const limit = Math.min(request.maxDistanceKm ?? 25, tutor.travelRadiusKm ?? 15);
    if (km <= limit) return 1 - (km / limit) * 0.3; // nearer is better
    if (km <= limit * 1.5) return 0.4;
    return 0;
  }

  // The parent would also accept online, and the tutor offers it.
  if (wantsOnline && offersOnline) return 0.7;
  return 0;
}

function scoreBudget(tutor, request) {
  const rate = tutor.minHourlyRateCents ?? tutor.hourlyRateCents;
  const max = request.budgetMaxCents;
  if (!max) return 0.5;

  if (rate <= max) {
    // Comfortably inside budget scores highest.
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

function scoreAvailability(availability, request) {
  if (!availability?.weeklyRules?.length) return 0;
  const wanted = AVAILABILITY_WINDOWS.filter((w) =>
    (request.preferredWindows ?? []).includes(w.value),
  );
  if (!wanted.length) return 0.5;

  const matched = wanted.filter((w) => matchesAvailabilityWindow(availability, w));
  return matched.length / wanted.length;
}

function scoreQuality(tutor) {
  const rating = tutor.stats?.ratingAverage ?? 0;
  const count = tutor.stats?.ratingCount ?? 0;
  if (!count) return 0.4; // new tutors are not penalised into invisibility
  const ratingScore = Math.min(rating / 5, 1);
  const confidence = Math.min(count / 10, 1);
  return ratingScore * 0.7 + confidence * 0.3;
}

/** Explain a score in plain language for the comparison view. */
export function explainMatch(breakdown, distanceKm) {
  const reasons = [];
  if (breakdown.course >= MATCH_WEIGHTS.course) reasons.push("Teaches this exact course");
  else if (breakdown.course > 0) reasons.push("Teaches this subject at a similar level");

  if (breakdown.location >= MATCH_WEIGHTS.location * 0.8) {
    reasons.push(distanceKm != null ? `About ${Math.round(distanceKm)} km away` : "Available online");
  }
  if (breakdown.budget >= MATCH_WEIGHTS.budget) reasons.push("Within your budget");
  if (breakdown.availability >= MATCH_WEIGHTS.availability * 0.8) {
    reasons.push("Free when you need lessons");
  }
  return reasons;
}
