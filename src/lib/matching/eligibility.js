import { LESSON_MODES, USER_STATUS, TUTOR_STATUS, REQUEST_STATUS } from "@/constants";
import { distanceKm } from "@/lib/geo";

/**
 * Who may be recommended at all (§22, §42).
 *
 * Scoring decides *order*; this decides *membership*. The distinction matters:
 * a weight an operator can retune must never be able to promote a tutor who
 * is unapproved, suspended, out of area or unable to teach the lesson at all.
 * Every one of those is a hard gate, checked here, and no score can pass it.
 *
 * The same rules are expressed twice on purpose:
 *
 *   `matchCandidateQuery()` narrows the database read, so a marketplace with
 *   fifty thousand tutors does not load them all;
 *   `isEligibleForMatch()` re-checks each candidate in memory, because the
 *   query cannot express every rule and a stale index must never be the only
 *   thing standing between an unapproved profile and a recommendation.
 */

/** Tutor-side state that makes a profile recommendable at all. */
export function matchCandidateQuery(request) {
  const query = {
    isSearchable: true,
    status: TUTOR_STATUS.APPROVED,
    acceptingNewStudents: true,
    // Subject-level net: the scorer, not the query, decides relevance.
    $or: [{ courseIds: request.courseId }, { subjectIds: request.subjectId }],
  };

  if (request.modes?.length) {
    query.lessonModes = { $in: request.modes };
  }

  // An in-person-only request can only ever be served by someone who can get
  // there, so the geo bound belongs in the query rather than in the scorer.
  const inPersonOnly =
    request.modes?.includes(LESSON_MODES.IN_PERSON) &&
    !request.modes?.includes(LESSON_MODES.ONLINE);

  if (inPersonOnly && request.location?.coordinates?.length === 2) {
    query.location = {
      $geoWithin: {
        $centerSphere: [request.location.coordinates, (request.maxDistanceKm ?? 25) / 6378.1],
      },
    };
  }

  return query;
}

/**
 * Whether a request is live right now (R18.11).
 *
 * OPEN alone is not enough: the daily `request-expiry` job is what moves an
 * aged-out request to EXPIRED, and no read or write may depend on that job
 * having run. So "live" is derived from the clock on every call — OPEN, and
 * either no expiry or one still in the future — and the job only settles the
 * stored record afterwards.
 */
export function isRequestLive(request, now = new Date()) {
  if (request?.status !== REQUEST_STATUS.OPEN) return false;
  if (!request.expiresAt) return true;
  return new Date(request.expiresAt).getTime() > new Date(now).getTime();
}

/** OPEN but past its expiry — expired in everything but the stored status. */
export function isRequestLapsed(request, now = new Date()) {
  return request?.status === REQUEST_STATUS.OPEN && !isRequestLive(request, now);
}

/**
 * The same rule as `isRequestLive`, as a MongoDB filter, for the reads that
 * select live requests (the tutor board, the per-family open-request cap).
 * `expiresAt: null` matches both an explicit null and an absent field.
 */
export function liveRequestFilter(now = new Date()) {
  return {
    status: REQUEST_STATUS.OPEN,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date(now) } }],
  };
}

/** A request that is not live cannot gain new matches. */
export function requestAcceptsMatches(request, now = new Date()) {
  return isRequestLive(request, now);
}

/**
 * Re-check one candidate against every hard rule.
 *
 * @param {object} tutor     A TutorProfile (lean), with `userId` populated
 *                           when the account's own status should be checked.
 * @param {object} request   The TutorRequest being matched.
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function isEligibleForMatch(tutor, request) {
  if (!tutor) return no("no profile");

  if (tutor.status !== TUTOR_STATUS.APPROVED) return no("profile is not approved");
  if (!tutor.isSearchable) return no("profile is not searchable");
  if (!tutor.acceptingNewStudents) return no("not taking new students");

  // `userId` is an ObjectId when unpopulated; only judge the account when the
  // caller actually loaded it, rather than inferring "fine" from its absence.
  const account = tutor.userId && typeof tutor.userId === "object" ? tutor.userId : null;
  if (account) {
    if (account.status && account.status !== USER_STATUS.ACTIVE) return no("account is not active");
    if (account.deletedAt) return no("account is closed");
    if (request?.ownerId && String(account._id ?? account.id) === String(request.ownerId)) {
      return no("cannot be matched to their own request");
    }
  }

  const modes = request?.modes?.length ? request.modes : [LESSON_MODES.ONLINE];
  const offersRequestedMode = modes.some((mode) => tutor.lessonModes?.includes(mode));
  if (!offersRequestedMode) return no("does not offer the lesson type asked for");

  // Teaches the subject at all. Without this a tutor with no overlap could be
  // carried into the list by location and quality alone.
  const teaches =
    (tutor.courseIds ?? []).some((id) => String(id) === String(request?.courseId)) ||
    (tutor.subjectIds ?? []).some((id) => String(id) === String(request?.subjectId));
  if (!teaches) return no("does not teach this subject");

  // In-person-only: both the family's limit and the tutor's own travel radius
  // have to be satisfied. Neither side is asked to travel further than they
  // agreed to.
  const inPersonOnly =
    modes.includes(LESSON_MODES.IN_PERSON) && !modes.includes(LESSON_MODES.ONLINE);
  if (inPersonOnly) {
    const km = pairDistanceKm(tutor, request);
    if (km !== null) {
      const limit = Math.min(request?.maxDistanceKm ?? 25, tutor.travelRadiusKm ?? 15);
      if (km > limit) return no("outside the travel radius");
    }
  }

  return { eligible: true, reason: null };
}

/** Distance between a tutor and a request, or null when either has no point. */
export function pairDistanceKm(tutor, request) {
  const tutorCoords = tutor?.location?.coordinates;
  const requestCoords = request?.location?.coordinates;
  if (tutorCoords?.length !== 2 || requestCoords?.length !== 2) return null;
  return distanceKm(requestCoords, tutorCoords);
}

function no(reason) {
  return { eligible: false, reason };
}
