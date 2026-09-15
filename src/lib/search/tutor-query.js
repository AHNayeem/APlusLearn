import { LESSON_MODES, AVAILABILITY_WINDOWS } from "@/constants";
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
export function buildTutorQuery(params, { coordinates } = {}) {
  const query = { isSearchable: true };
  const and = [];

  // --- What they teach ---
  if (params.courseId) query.courseIds = params.courseId;
  else if (params.courseCode) query.courseCodes = String(params.courseCode).toUpperCase();

  if (params.subject) query.subjectSlugs = params.subject;
  if (params.gradeLevel !== undefined) query.gradeLevels = params.gradeLevel;
  if (params.province) query.provinceCodes = String(params.province).toUpperCase();

  // --- Free text over headline/bio, and the tutor's own course names ---
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

  // --- Lesson mode ---
  if (params.mode && params.mode !== "ANY") {
    query.lessonModes = params.mode;
  }

  // --- Location. In-person implies a geo constraint; online is borderless. ---
  if (coordinates && params.mode !== LESSON_MODES.ONLINE) {
    const radiusKm = params.distanceKm ?? 25;
    query.location = {
      $geoWithin: { $centerSphere: [coordinates, radiusKm / 6378.1] },
    };
  } else if (params.city && params.mode !== LESSON_MODES.ONLINE) {
    query.city = new RegExp(`^${escapeRegex(params.city)}$`, "i");
  }

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
  if (params.qualifications?.length) query.qualifications = { $all: params.qualifications };
  if (params.verified?.length) query.verifiedTypes = { $all: params.verified };
  if (params.languages?.length) query.languages = { $in: params.languages };
  if (params.freeIntro) query.offersFreeIntro = true;
  if (params.acceptingNew !== undefined) query.acceptingNewStudents = params.acceptingNew;

  if (and.length) query.$and = and;
  return query;
}

/**
 * Availability windows live on a separate collection, so the search service
 * resolves matching tutor ids first and passes them in as a constraint.
 */
export function availabilityWindowFilter(windows = []) {
  const selected = AVAILABILITY_WINDOWS.filter((w) => windows.includes(w.value));
  if (!selected.length) return null;

  return {
    $or: selected.map((w) => ({
      weeklyRules: {
        $elemMatch: {
          weekday: { $in: w.days },
          startMinutes: { $lt: w.to * 60 },
          endMinutes: { $gt: w.from * 60 },
        },
      },
    })),
  };
}

export function buildTutorSort(sort) {
  switch (sort) {
    case "RATING":
      return { "stats.ratingAverage": -1, "stats.ratingCount": -1 };
    case "PRICE_ASC":
      return { hourlyRateCents: 1, "stats.ratingAverage": -1 };
    case "PRICE_DESC":
      return { hourlyRateCents: -1, "stats.ratingAverage": -1 };
    case "EXPERIENCE":
      return { yearsExperience: -1, "stats.ratingAverage": -1 };
    case "AVAILABILITY":
      return { nextAvailableAt: 1, "stats.ratingAverage": -1 };
    case "DISTANCE":
      // Distance ordering is applied after the geo query resolves; fall back
      // to quality so the result is still deterministic.
      return { "stats.ratingAverage": -1 };
    case "RELEVANCE":
    default:
      // Verified, well-rated, active tutors first — the marketplace's default
      // notion of "best match".
      return {
        "stats.ratingAverage": -1,
        "stats.ratingCount": -1,
        "stats.completedLessons": -1,
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
