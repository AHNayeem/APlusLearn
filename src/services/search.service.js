import "server-only";
import { TutorProfile, Availability, Favourite, Course, Subject, Grade } from "@/models";
import { PAGE_SIZES, AVAILABILITY_WINDOWS, LESSON_MODES } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { geocode, distanceKm } from "@/lib/geo";
import {
  buildTutorQuery,
  buildTutorSort,
  availabilityWindowFilter,
} from "@/lib/search/tutor-query";
import { toPublicTutor } from "./tutor.service";
import { getSettings } from "./settings.service";

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

  const [docs, total] = await Promise.all([
    TutorProfile.find(query)
      .sort(sort)
      .skip((params.page - 1) * pageSize)
      .limit(pageSize)
      .populate("userId", "firstName lastName avatarUrl")
      .lean(),
    TutorProfile.countDocuments(query),
  ]);

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
    // Show the rate for the searched course, not just the base rate.
    displayRateCents: resolved.course
      ? (profile.courses?.find((c) => String(c.courseId) === resolved.course.id)?.hourlyRateCents ??
        profile.hourlyRateCents)
      : profile.hourlyRateCents,
  }));

  if (params.sort === "DISTANCE" && coordinates) {
    items = items.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  }

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

/** Homepage and course-page rails. */
export async function featuredTutors({ limit = 6, courseId, subjectSlug, province } = {}) {
  const query = { isSearchable: true, acceptingNewStudents: true };
  if (courseId) query.courseIds = courseId;
  if (subjectSlug) query.subjectSlugs = subjectSlug;
  if (province) query.provinceCodes = String(province).toUpperCase();

  const docs = await TutorProfile.find(query)
    .sort({ "stats.ratingAverage": -1, "stats.ratingCount": -1, "stats.completedLessons": -1 })
    .limit(limit)
    .populate("userId", "firstName lastName avatarUrl")
    .lean();

  return docs.map((profile) => toPublicTutor(profile, profile.userId));
}

/** Marketplace supply counts used across public pages. */
export async function marketplaceStats() {
  const [tutors, cities, subjects] = await Promise.all([
    TutorProfile.countDocuments({ isSearchable: true }),
    TutorProfile.distinct("city", { isSearchable: true }),
    TutorProfile.distinct("subjectSlugs", { isSearchable: true }),
  ]);

  return {
    tutorCount: tutors,
    cityCount: cities.filter(Boolean).length,
    subjectCount: subjects.filter(Boolean).length,
  };
}
