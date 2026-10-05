import { LESSON_MODES } from "@/constants";
import { escapeRegex } from "@/lib/security/sanitize";

/**
 * Translate validated search input into a MongoDB query and sort (§14).
 *
 * Kept pure and separate from the service so the query shape can be reasoned
 * about (and unit-tested) without a database.
 *
 * The first clause is always `isSearchable: true` — an unapproved tutor can
 * never appear in search, whatever else the filters say (§42).
 */
export function buildTutorQuery(params, { location, courseIds } = {}) {
  const query = { isSearchable: true };
  const and = [];

  // --- What they teach. `courseIds` is the curriculum the search service
  //     resolved (a code, a course name or slug, an alias). ---
  if (courseIds?.length) query.courseIds = { $in: courseIds };
  else if (params.courseId) query.courseIds = params.courseId;
  else if (params.courseCode) query.courseCodes = String(params.courseCode).toUpperCase();

  if (params.subject) query.subjectSlugs = params.subject;
  if (params.gradeLevel !== undefined) query.gradeLevels = params.gradeLevel;
  if (params.province) query.provinceCodes = String(params.province).toUpperCase();

  // --- Free text, only when the words were not a course or a subject ---
  if (params.q) {
    const pattern = new RegExp(escapeRegex(params.q), "i");
    and.push({
      $or: [
        { headline: pattern },
        { bio: pattern },
        { "courses.name": pattern },
        { "courses.code": pattern },
        { city: pattern },
      ],
    });
  }

  // --- Lesson format ---
  if (params.mode === LESSON_MODES.ONLINE || params.mode === LESSON_MODES.IN_PERSON) {
    query.lessonModes = params.mode;
  } else if (params.mode === "BOTH") {
    query.lessonModes = { $all: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON] };
  }

  const where = locationClause(params.mode, location);
  if (where) and.push(where);

  // --- Price. Compare against the tutor's lowest rate so a per-course
  //     override inside the range still surfaces the tutor. ---
  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    const priceFilter = {};
    if (params.minPrice !== undefined) priceFilter.$gte = params.minPrice;
    if (params.maxPrice !== undefined) priceFilter.$lte = params.maxPrice;
    and.push({
      $or: [{ minHourlyRateCents: priceFilter }, { hourlyRateCents: priceFilter }],
    });
  }

  // --- Quality and credentials ---
  if (params.minRating) query["stats.ratingAverage"] = { $gte: params.minRating };
  if (params.minExperience) query.yearsExperience = { $gte: params.minExperience };
  // Any of the chosen qualifications (a parent ticking "Master's" and "PhD"
  // wants either); every chosen verification (each is a requirement).
  if (params.qualifications?.length) query.qualifications = { $in: params.qualifications };
  if (params.verified?.length) query.verifiedTypes = { $all: params.verified };
  if (params.languages?.length) query.languages = { $in: params.languages };
  if (params.freeIntro) query.offersFreeIntro = true;
  if (params.acceptingNew !== undefined) query.acceptingNewStudents = params.acceptingNew;

  if (and.length) query.$and = and;
  return query;
}

const EARTH_RADIUS_KM = 6378.1;

/**
 * Where a lesson can happen, given the visitor's location (§7, §29).
 *
 * Distance only constrains *in-person* teaching. An online lesson has no
 * distance, so a search with a location and no format still returns every
 * online tutor for the course — the location decides which in-person tutors
 * join them, it never removes online ones (R7.7).
 *
 * `location.status`:
 *   RESOLVED      — coordinates known: in-person tutors within `radiusKm`
 *                   (null radius = any distance, R8.5), among tutors who
 *                   have a known location at all.
 *   UNRESOLVED    — the place is not known to the geocoder: in-person tutors
 *                   whose own profile names that city (or postal prefix),
 *                   never a guessed coordinate (R29.1).
 *   OUT_OF_REGION / INVALID — the place cannot be served in person for this
 *                   search (a postal code in another province, a malformed
 *                   code): no in-person tutors; online ones still match.
 */
export function locationClause(mode, location) {
  if (!location || location.status === "NONE" || mode === LESSON_MODES.ONLINE) return null;

  let nearby = null;
  if (location.status === "RESOLVED" && location.coordinates) {
    nearby = location.radiusKm
      ? {
          location: {
            $geoWithin: { $centerSphere: [location.coordinates, location.radiusKm / EARTH_RADIUS_KM] },
          },
        }
      : { "location.coordinates": { $exists: true } };
  } else if (location.status === "UNRESOLVED") {
    if (location.postalPrefix) nearby = { postalCodePrefix: location.postalPrefix };
    else if (location.cityName) nearby = { city: new RegExp(`^${escapeRegex(location.cityName)}$`, "i") };
  }

  const inPersonNearby = nearby ? { lessonModes: LESSON_MODES.IN_PERSON, ...nearby } : null;

  if (mode === LESSON_MODES.IN_PERSON || mode === "BOTH") {
    // Nothing can be met in person here: say so with an empty result rather
    // than quietly dropping the location.
    return inPersonNearby ?? { _id: { $in: [] } };
  }

  // "Online or in person": online tutors, plus in-person tutors nearby.
  return {
    $or: [{ lessonModes: LESSON_MODES.ONLINE }, ...(inPersonNearby ? [inPersonNearby] : [])],
  };
}

/**
 * `_id` closes every sort.
 *
 * Without a unique final key, two tutors with identical ratings can swap
 * places between two reads of the same query — which shows up as a result
 * appearing twice on page one and never on page two. It costs nothing and it
 * is what makes paging through search results trustworthy.
 */
export function buildTutorSort(sort) {
  switch (sort) {
    case "RATING":
      return { "stats.ratingAverage": -1, "stats.ratingCount": -1, _id: 1 };
    case "PRICE_ASC":
      return { hourlyRateCents: 1, "stats.ratingAverage": -1, _id: 1 };
    case "PRICE_DESC":
      return { hourlyRateCents: -1, "stats.ratingAverage": -1, _id: 1 };
    case "EXPERIENCE":
      return { yearsExperience: -1, "stats.ratingAverage": -1, _id: 1 };
    case "AVAILABILITY":
    case "DISTANCE":
      // Both are ranked by the search service over the whole matched set —
      // distance from the resolved location, soonest real open slot — not
      // by an index. This is the tie-break order inside that ranking.
      return { "stats.ratingAverage": -1, "stats.ratingCount": -1, _id: 1 };
    case "RELEVANCE":
    default:
      // Verified, well-rated, active tutors first — the marketplace's default
      // notion of "best match".
      return {
        "stats.ratingAverage": -1,
        "stats.ratingCount": -1,
        "stats.completedLessons": -1,
        _id: 1,
      };
  }
}

export const SORT_OPTIONS = [
  { value: "RELEVANCE", label: "Best match" },
  { value: "RATING", label: "Highest rated" },
  { value: "PRICE_ASC", label: "Price: low to high" },
  { value: "PRICE_DESC", label: "Price: high to low" },
  { value: "EXPERIENCE", label: "Most experienced" },
  { value: "AVAILABILITY", label: "Soonest available" },
  { value: "DISTANCE", label: "Closest to me" },
];
