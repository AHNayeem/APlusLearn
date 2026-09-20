import "server-only";
import { TutorProfile, Availability, Favourite, Course, Subject, Grade } from "@/models";
import { PAGE_SIZES, AVAILABILITY_WINDOWS, LESSON_MODES } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { distanceKm } from "@/lib/geo";
import { geocode } from "./external/geocoding-provider";
import {
  buildTutorQuery,
  buildTutorSort,
  availabilityWindowFilter,
} from "@/lib/search/tutor-query";
import { promotionAffectsSort, promotedPageSlice, promotionLimits } from "@/lib/search/promotion";
import { toPublicTutor, attachAvailableWeekdays } from "./tutor.service";
import { getSettings } from "./settings.service";
import { livePromotedProfileIds } from "./promotion.service";

/**
 * Tutor search (§14).
 *
 * Resolution order matters: curriculum slugs become ids, a location becomes
 * coordinates, availability windows become a tutor-id constraint, and only
 * then does the main query run. Results are always shaped through
 * `toPublicTutor`, so no private field can leak into a search response.
 */
export async function searchTutors(params, { viewerId } = {}) {
  const settings = await getSettings();
  const pageSize = params.pageSize ?? PAGE_SIZES.tutorSearch;

  const resolved = await resolveCurriculum(params);
  const coordinates = await resolveLocation(params);

  const query = buildTutorQuery(
    {
      ...params,
      courseId: resolved.course?.id,
      gradeLevel: resolved.grade?.level,
      distanceKm: params.distanceKm ?? settings.defaultSearchRadiusKm,
    },
    { coordinates },
  );

  // Availability lives on its own collection, so narrow by tutor id first.
  if (params.availability?.length) {
    const filter = availabilityWindowFilter(params.availability);
    if (filter) {
      const ids = await Availability.find(filter).distinct("tutorProfileId");
      query._id = query._id ? { $in: ids, ...query._id } : { $in: ids };
    }
  }

  const sort = buildTutorSort(params.sort);

  const { docs, total, promotedIds } = await readPage({
    query,
    sort,
    page: params.page,
    pageSize,
    settings,
    // An explicit ordering is an instruction from the visitor, and promotion
    // stands down in front of it. See lib/search/promotion.js.
    allowPromotion: promotionAffectsSort(params.sort),
  });

  // Saved state, so the heart on each card renders correctly on first paint.
  let favouriteIds = new Set();
  if (viewerId) {
    const favourites = await Favourite.find({
      userId: viewerId,
      tutorProfileId: { $in: docs.map((d) => d._id) },
    })
      .select("tutorProfileId")
      .lean();
    favouriteIds = new Set(favourites.map((f) => String(f.tutorProfileId)));
  }

  let items = docs.map((profile) => ({
    ...toPublicTutor(profile, profile.userId, {
      distanceKm: coordinates ? distanceKm(coordinates, profile.location?.coordinates ?? []) : null,
    }),
    isFavourite: favouriteIds.has(String(profile._id)),
    // Disclosed, always. A paid placement a visitor cannot see is an
    // advertising problem, not a ranking one.
    isPromoted: promotedIds.has(String(profile._id)),
    // Show the rate for the searched course, not just the base rate.
    displayRateCents: resolved.course
      ? (profile.courses?.find((c) => String(c.courseId) === resolved.course.id)?.hourlyRateCents ??
        profile.hourlyRateCents)
      : profile.hourlyRateCents,
  }));

  if (params.sort === "DISTANCE" && coordinates) {
    items = items.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  }

  items = await attachAvailableWeekdays(items);

  return {
    items,
    total,
    page: params.page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    resolved: {
      course: resolved.course,
      subject: resolved.subject,
      grade: resolved.grade,
      coordinates,
      radiusKm: params.distanceKm ?? settings.defaultSearchRadiusKm,
    },
  };
}

/**
 * Read one page of tutors, with the promotion adjustment applied last (§41).
 *
 * The ordering this produces is: the boosted tutors, in their normal ranked
 * order, then everyone else, in their normal ranked order. Both halves are
 * drawn with the *same* filter — the one the visitor's search built, starting
 * at `isSearchable: true` — so a promotion can only ever move a tutor who was
 * already going to be in these results. It cannot add one, and it cannot
 * change how many there are.
 *
 * Why two reads rather than one sorted on a computed field: a computed sort
 * key cannot use an index, so every search would sort the whole matched set
 * in memory. The boosted read is bounded by the operator's ceiling (a handful
 * of ids), and the remainder read is the query this function replaced,
 * unchanged and still index-backed.
 */
async function readPage({ query, sort, page, pageSize, settings, allowPromotion }) {
  const total = await TutorProfile.countDocuments(query);
  const { maxPromotedPerSearch } = promotionLimits(settings);

  const read = (extra, skip, limit) =>
    limit <= 0
      ? Promise.resolve([])
      : TutorProfile.find({ ...query, ...extra })
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .populate("userId", "firstName lastName avatarUrl")
          .lean();

  const candidateIds = allowPromotion
    ? await livePromotedProfileIds({ settings })
    : [];

  if (!candidateIds.length) {
    return {
      docs: await read({}, (page - 1) * pageSize, pageSize),
      total,
      promotedIds: new Set(),
    };
  }

  // Which promoted tutors survive this search's own filters, best-ranked
  // first, capped at the fairness ceiling. A promoted tutor who does not
  // match the filters simply is not here — promotion is not a bypass.
  const boosted = await TutorProfile.find({ ...query, _id: { $in: candidateIds } })
    .sort(sort)
    .limit(maxPromotedPerSearch)
    .select("_id")
    .lean();

  const boostedIds = boosted.map((d) => d._id);
  if (!boostedIds.length) {
    return {
      docs: await read({}, (page - 1) * pageSize, pageSize),
      total,
      promotedIds: new Set(),
    };
  }

  const slice = promotedPageSlice({
    promotedCount: boostedIds.length,
    page,
    pageSize,
  });

  const [promotedDocs, normalDocs] = await Promise.all([
    read({ _id: { $in: boostedIds } }, slice.promotedSkip, slice.promotedLimit),
    // Excluding the boosted ids is what stops a promoted tutor being shown
    // twice — once lifted, once again in their natural position.
    read({ _id: { $nin: boostedIds } }, slice.normalSkip, slice.normalLimit),
  ]);

  return {
    docs: [...promotedDocs, ...normalDocs],
    total,
    promotedIds: new Set(boostedIds.map(String)),
  };
}

/** Turn URL slugs into the curriculum records the query needs. */
async function resolveCurriculum(params) {
  const out = { course: null, subject: null, grade: null };

  if (params.courseCode) {
    const courseQuery = { code: String(params.courseCode).toUpperCase(), isActive: true };
    if (params.province) courseQuery.provinceCode = params.province;
    const course = await Course.findOne(courseQuery).lean();
    if (course) out.course = toPlain(course);
  }

  if (!out.course && params.course) {
    const courseQuery = { slug: params.course, isActive: true };
    if (params.province) courseQuery.provinceCode = params.province;
    if (params.grade) courseQuery.gradeSlug = params.grade;
    const course = await Course.findOne(courseQuery).lean();
    if (course) out.course = toPlain(course);
  }

  if (params.subject) {
    const subject = await Subject.findOne({ slug: params.subject }).lean();
    if (subject) out.subject = toPlain(subject);
  }

  if (params.grade) {
    const gradeQuery = { slug: params.grade, isActive: true };
    const grade = await Grade.findOne(gradeQuery).lean();
    if (grade) out.grade = toPlain(grade);
  }

  return out;
}

async function resolveLocation(params) {
  if (params.mode === LESSON_MODES.ONLINE) return null;
  if (params.lat !== undefined && params.lng !== undefined) return [params.lng, params.lat];
  if (!params.postalCode && !params.city) return null;

  const geo = await geocode({
    postalCode: params.postalCode,
    city: params.city,
    province: params.province,
  });
  return geo?.coordinates ?? null;
}

/**
 * Facet counts for the filter rail, computed against the *unfiltered-by-that-
 * facet* result set so a parent can see what selecting an option would give.
 */
export async function searchFacets(params) {
  const coordinates = await resolveLocation(params);
  const resolved = await resolveCurriculum(params);
  const base = buildTutorQuery(
    { ...params, courseId: resolved.course?.id, gradeLevel: resolved.grade?.level },
    { coordinates },
  );

  const [modes, verification, priceStats] = await Promise.all([
    TutorProfile.aggregate([
      { $match: base },
      { $unwind: "$lessonModes" },
      { $group: { _id: "$lessonModes", count: { $sum: 1 } } },
    ]),
    TutorProfile.aggregate([
      { $match: base },
      { $unwind: "$verifiedTypes" },
      { $group: { _id: "$verifiedTypes", count: { $sum: 1 } } },
    ]),
    TutorProfile.aggregate([
      { $match: base },
      {
        $group: {
          _id: null,
          min: { $min: "$hourlyRateCents" },
          max: { $max: "$hourlyRateCents" },
          avg: { $avg: "$hourlyRateCents" },
        },
      },
    ]),
  ]);

  return {
    modes: Object.fromEntries(modes.map((m) => [m._id, m.count])),
    verification: Object.fromEntries(verification.map((v) => [v._id, v.count])),
    price: priceStats[0]
      ? {
          minCents: priceStats[0].min,
          maxCents: priceStats[0].max,
          avgCents: Math.round(priceStats[0].avg),
        }
      : null,
    availabilityWindows: AVAILABILITY_WINDOWS,
  };
}

/**
 * Homepage and course-page rails.
 *
 * These are a "best match" shortlist with no visitor-chosen ordering, so a
 * promotion applies here for the same reason it applies to the default search
 * sort — and is disclosed here the same way (§41 Phase 2).
 */
export async function featuredTutors({ limit = 6, courseId, subjectSlug, province } = {}) {
  const query = { isSearchable: true, acceptingNewStudents: true };
  if (courseId) query.courseIds = courseId;
  if (subjectSlug) query.subjectSlugs = subjectSlug;
  if (province) query.provinceCodes = String(province).toUpperCase();

  const settings = await getSettings();
  const { docs, promotedIds } = await readPage({
    query,
    sort: buildTutorSort("RELEVANCE"),
    page: 1,
    pageSize: limit,
    settings,
    allowPromotion: true,
  });

  return attachAvailableWeekdays(
    docs.map((profile) => ({
      ...toPublicTutor(profile, profile.userId),
      isPromoted: promotedIds.has(String(profile._id)),
    })),
  );
}

/** Marketplace supply counts used across public pages. */
export async function marketplaceStats() {
  const [tutors, cities, subjects, courses] = await Promise.all([
    TutorProfile.countDocuments({ isSearchable: true }),
    TutorProfile.distinct("city", { isSearchable: true }),
    TutorProfile.distinct("subjectSlugs", { isSearchable: true }),
    // Catalogue breadth, not tutor coverage — this is the number the hero
    // quotes as "courses covered", and it is what makes course-code search
    // worth attempting in the first place.
    Course.countDocuments({ isActive: true }),
  ]);

  return {
    tutorCount: tutors,
    cityCount: cities.filter(Boolean).length,
    subjectCount: subjects.filter(Boolean).length,
    courseCount: courses,
  };
}
