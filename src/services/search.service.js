import "server-only";
import { TutorProfile, Favourite, Course, Subject, Grade } from "@/models";
import { PAGE_SIZES, LESSON_MODES } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { distanceKm, coarsenCoordinates, provincesForPostalCode } from "@/lib/geo";
import { slugify } from "@/lib/utils/slug";
import { escapeRegex } from "@/lib/security/sanitize";
import { geocode } from "./external/geocoding-provider";
import { buildTutorQuery, buildTutorSort } from "@/lib/search/tutor-query";
import { buildAvailabilityFilter } from "@/lib/search/availability-filter";
import { promotionAffectsSort, promotedPageSlice, promotionLimits } from "@/lib/search/promotion";
import { toPublicTutor, attachAvailableWeekdays } from "./tutor.service";
import { getSettings } from "./settings.service";
import { livePromotedProfileIds } from "./promotion.service";
import { activeProvinceCodes, getProvince } from "./curriculum.service";
import { firstOpenSlots, nextAvailableFor } from "./availability.service";

/**
 * Tutor search (§7, §8, §14).
 *
 * Resolution order matters: the words and slugs become curriculum records,
 * a location becomes coordinates (or an honest "unresolved"), availability
 * becomes the set of tutors with a real open slot, and only then does the
 * main query run. Results are always shaped through `toPublicTutor`, so no
 * private field can leak into a search response.
 */
export async function searchTutors(params, { viewerId } = {}) {
  const settings = await getSettings();
  const pageSize = params.pageSize ?? PAGE_SIZES.tutorSearch;

  const curriculum = await resolveCurriculum(params);
  const location = await resolveLocation(params, { settings, provinceCode: curriculum.provinceCode });
  const query = queryFor(params, curriculum, location);

  // Availability is a question about each tutor's real calendar, so it is
  // answered for every candidate before paging (R8.17–R8.21).
  const availabilityFilter = buildAvailabilityFilter(params);
  let matchingSlots = null;
  if (availabilityFilter) {
    const candidateIds = await TutorProfile.distinct("_id", query);
    matchingSlots = await firstOpenSlots(candidateIds, {
      days: availabilityFilter.days,
      acceptFor: availabilityFilter.acceptFor,
    });
    query._id = { $in: candidateIds.filter((id) => matchingSlots.get(String(id))) };
  }

  const sortKey = params.sort ?? "RELEVANCE";
  const sort = buildTutorSort(sortKey);
  const coordinates = location.status === "RESOLVED" ? location.coordinates : null;

  let pageResult;
  if (sortKey === "DISTANCE" && coordinates) {
    pageResult = await rankedPage({
      query, sort, page: params.page, pageSize,
      rank: async (candidates) =>
        new Map(candidates.map((c) => [String(c._id), distanceFor(c, coordinates) ?? Infinity])),
    });
  } else if (sortKey === "AVAILABILITY") {
    pageResult = await rankedPage({
      query, sort, page: params.page, pageSize,
      rank: async (candidates) => {
        const ids = candidates.map((c) => c._id);
        const next = matchingSlots
          ? new Map(ids.map((id) => [String(id), matchingSlots.get(String(id))?.startAt]))
          : await nextAvailableFor(ids);
        return new Map(
          ids.map((id) => {
            const at = next.get(String(id));
            return [String(id), at ? new Date(at).getTime() : Infinity];
          }),
        );
      },
    });
  } else {
    pageResult = await readPage({
      query,
      sort,
      page: params.page,
      pageSize,
      settings,
      // An explicit ordering is an instruction from the visitor, and promotion
      // stands down in front of it. See lib/search/promotion.js.
      allowPromotion: promotionAffectsSort(sortKey),
    });
  }
  const { docs, total, promotedIds } = pageResult;

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

  const singleCourse = curriculum.courses?.length === 1 ? curriculum.courses[0] : null;
  let items = docs.map((profile) => ({
    ...toPublicTutor(profile, profile.userId, { distanceKm: distanceFor(profile, coordinates) }),
    isFavourite: favouriteIds.has(String(profile._id)),
    // Disclosed, always. A paid placement a visitor cannot see is an
    // advertising problem, not a ranking one.
    isPromoted: promotedIds.has(String(profile._id)),
    // Show the rate for the searched course, not just the base rate.
    displayRateCents: singleCourse
      ? (profile.courses?.find((c) => String(c.courseId) === singleCourse.id)?.hourlyRateCents ??
        profile.hourlyRateCents)
      : profile.hourlyRateCents,
    // The first slot that answered the visitor's availability question.
    matchingSlotAt: matchingSlots?.get(String(profile._id))?.startAt ?? null,
  }));

  items = await withLiveAvailability(await attachAvailableWeekdays(items));

  return {
    items,
    total,
    page: params.page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    resolved: {
      province: curriculum.province,
      course: singleCourse,
      courses: curriculum.courses ?? [],
      subject: curriculum.subject,
      grade: curriculum.grade,
      queryKind: curriculum.queryKind,
      text: curriculum.text,
      unmatched: curriculum.unmatched,
      location: publicLocation(location),
      coordinates,
      radiusKm: location.radiusKm ?? null,
    },
  };
}

/**
 * Replace each card's stored "next available" with the live answer from the
 * booking calendar (§9, R9.10). The stored copy can be stale; this cannot,
 * because it is computed from the same rules and busy time a booking checks.
 */
export async function withLiveAvailability(items) {
  if (!items?.length) return items ?? [];
  const next = await nextAvailableFor(items.map((t) => t.id));
  return items.map((tutor) => {
    const at = next.get(String(tutor.id));
    return { ...tutor, nextAvailableAt: at ? at.toISOString() : null };
  });
}

/** Distance to an in-person tutor with a known location, or null (R9.7). */
function distanceFor(profile, coordinates) {
  if (!coordinates) return null;
  if (!(profile.lessonModes ?? []).includes(LESSON_MODES.IN_PERSON)) return null;
  const point = profile.location?.coordinates;
  if (!Array.isArray(point) || point.length !== 2) return null;
  return distanceKm(coordinates, point);
}

function queryFor(params, curriculum, location) {
  const query = buildTutorQuery(
    {
      ...params,
      q: curriculum.text,
      subject: curriculum.subjectSlug,
      gradeLevel: curriculum.grade?.level,
      province: curriculum.provinceCode,
      courseCode: undefined,
      courseId: undefined,
    },
    { location, courseIds: curriculum.courseIds },
  );
  // A course, grade or subject that was asked for by name and does not
  // exist narrows to nothing — it never silently widens to everything.
  if (curriculum.unmatched) query._id = { $in: [] };
  return query;
}

/**
 * Rank the whole matched set by a computed key, then page it (R8.5, R9.10).
 *
 * "Closest" and "soonest available" are properties of the visitor's location
 * and of each tutor's live calendar, so no index can order them. The matched
 * set is read as ids plus the few fields the ranking needs, ordered, and
 * only the requested page is loaded in full — page two is the next twelve
 * of the *same* ordering, not a re-sort of the next twelve by rating.
 */
async function rankedPage({ query, sort, page, pageSize, rank }) {
  const candidates = await TutorProfile.find(query)
    .select("_id location lessonModes stats")
    .sort(sort)
    .lean();
  const keys = await rank(candidates);
  // Array#sort is stable, so ties keep the quality order `sort` produced.
  candidates.sort((a, b) => {
    const ka = keys.get(String(a._id)) ?? Infinity;
    const kb = keys.get(String(b._id)) ?? Infinity;
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });

  const ids = candidates.slice((page - 1) * pageSize, page * pageSize).map((c) => c._id);
  const docs = await TutorProfile.find({ _id: { $in: ids } })
    .populate("userId", "firstName lastName avatarUrl")
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  return {
    docs: ids.map((id) => byId.get(String(id))).filter(Boolean),
    total: candidates.length,
    promotedIds: new Set(),
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

/**
 * Turn what the visitor typed and picked into curriculum records (§6, §7).
 *
 * Explicit parameters (`courseCode`, `course`, `subject`, `grade`) are
 * resolved as themselves — slugs or their aliases, scoped to the province
 * when one is chosen. The free-text `q` is then matched against the live
 * curriculum, most specific first: a real course code, a subject (name,
 * short name, slug or alias), a course name/slug/alias; only words that are
 * none of those are searched as text. That is what keeps "Math" a subject,
 * "MHF4U" a course and "Physics" from ever being treated as a course code —
 * the data decides, not the shape of the word (R2.5, R6.4).
 */
async function resolveCurriculum(params) {
  const provinceCode = params.province ? String(params.province).toUpperCase() : null;
  const scope = provinceCode ? [provinceCode] : await activeProvinceCodes();
  const out = {
    provinceCode,
    province: provinceCode ? await getProvince(provinceCode) : null,
    grade: null,
    subject: null,
    subjectSlug: undefined,
    courses: null,
    courseIds: null,
    text: undefined,
    queryKind: "NONE",
    unmatched: false,
  };

  if (params.grade) {
    const gradeQuery = { isActive: true, $or: [{ slug: params.grade }, { aliases: params.grade }] };
    if (out.province) gradeQuery.provinceId = out.province.id;
    const grade = await Grade.findOne(gradeQuery).lean();
    if (grade) out.grade = toPlain(grade);
    else out.unmatched = true;
  }

  if (params.subject) {
    const subject = await findSubject(params.subject);
    out.subject = subject;
    // An unknown subject slug keeps filtering on what was asked for, which
    // matches nobody — rather than being dropped and matching everybody.
    out.subjectSlug = subject?.slug ?? params.subject;
  }

  if (params.courseCode) {
    out.courses = await findCourses({ code: String(params.courseCode).toUpperCase() }, scope);
    out.queryKind = "COURSE_CODE";
    if (!out.courses.length) out.unmatched = true;
  } else if (params.course) {
    const slug = slugify(params.course);
    out.courses = await findCourses(
      { $or: [{ slug }, { aliases: slug }], ...(out.grade ? { gradeSlug: out.grade.slug } : {}) },
      scope,
    );
    out.queryKind = "COURSE";
    if (!out.courses.length) out.unmatched = true;
  }

  if (params.q) {
    const typed = await interpretQuery(params.q, { scope, grade: out.grade });
    if (typed.kind === "SUBJECT") {
      if (!params.subject) {
        out.subject = typed.subject;
        out.subjectSlug = typed.subject.slug;
      }
      if (out.queryKind === "NONE") out.queryKind = "SUBJECT";
    } else if (typed.kind === "COURSE_CODE" || typed.kind === "COURSE") {
      // Typed words narrow an explicitly chosen course; they never replace it.
      out.courses = out.courses
        ? out.courses.filter((c) => typed.courses.some((t) => t.id === c.id))
        : typed.courses;
      if (!out.courses.length) out.unmatched = true;
      if (out.queryKind === "NONE") out.queryKind = typed.kind;
    } else {
      out.text = params.q;
      if (out.queryKind === "NONE") out.queryKind = "TEXT";
    }
  }

  if (out.courses) out.courseIds = out.courses.map((c) => c.id);
  return out;
}

async function findSubject(value) {
  const slug = slugify(value);
  if (!slug) return null;
  const exact = new RegExp(`^${escapeRegex(String(value).trim())}$`, "i");
  const doc = await Subject.findOne({
    isActive: true,
    $or: [{ slug }, { aliases: slug }, { name: exact }, { shortName: exact }],
  }).lean();
  return doc ? toPlain(doc) : null;
}

async function findCourses(filter, scope) {
  const docs = await Course.find({ ...filter, isActive: true, provinceCode: { $in: scope } })
    .select("name code slug gradeSlug gradeLevel subjectSlug subjectName provinceCode")
    .lean();
  return toPlain(docs);
}

/** What a typed query means, decided by the curriculum. */
async function interpretQuery(q, { scope, grade }) {
  const words = String(q).trim().replace(/\s+/g, " ");
  if (!words) return { kind: "NONE" };

  // A real course code in a province being searched — looked up, not guessed.
  const compact = words.replace(/[\s-]/g, "").toUpperCase();
  if (/^[A-Z0-9]{3,12}$/.test(compact)) {
    const byCode = await findCourses({ code: compact }, scope);
    if (byCode.length) return { kind: "COURSE_CODE", courses: byCode };
  }

  const subject = await findSubject(words);
  if (subject) return { kind: "SUBJECT", subject };

  const slug = slugify(words);
  const exact = new RegExp(`^${escapeRegex(words)}$`, "i");
  const byName = await findCourses(
    {
      $or: [{ name: exact }, { slug }, { aliases: slug }],
      ...(grade ? { gradeSlug: grade.slug } : {}),
    },
    scope,
  );
  if (byName.length) return { kind: "COURSE", courses: byName };

  return { kind: "TEXT" };
}

/** A Canadian postal code or forward sortation area, normalised, or null. */
function normalisePostal(value) {
  const compact = String(value ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[ABCEGHJ-NPRSTVXY]\d[A-Z](\d[A-Z]\d)?$/.test(compact) ? compact : null;
}

/**
 * Where the visitor is, as honestly as the data allows (§29, R29.1).
 *
 *   RESOLVED   — a coordinate from the geocoder, or, for a place the geocoder
 *                does not know, from the approximate locations of tutors who
 *                serve it (their own postal-area centroids — real data, not a
 *                guess).
 *   UNRESOLVED — nothing places it. In-person matching falls back to tutors
 *                whose profile names that city / postal area.
 *   INVALID    — not a Canadian postal code.
 *
 * Never a substituted city. The radius is the visitor's, "any", or the
 * operator's default.
 */
async function resolveLocation(params, { settings, provinceCode } = {}) {
  const radiusKm =
    params.distanceKm === "any" ? null : (params.distanceKm ?? settings?.defaultSearchRadiusKm ?? 25);
  const base = { status: "NONE", radiusKm, kind: "NONE" };

  if (params.mode === LESSON_MODES.ONLINE) return base;
  if (params.lat !== undefined && params.lng !== undefined) {
    return { ...base, status: "RESOLVED", kind: "COORDINATES", coordinates: coarsenCoordinates([params.lng, params.lat]) };
  }

  if (params.postalCode) {
    const postal = normalisePostal(params.postalCode);
    const input = String(params.postalCode).trim();
    if (!postal) return { ...base, status: "INVALID", kind: "POSTAL_CODE", input };
    const prefix = postal.slice(0, 3);
    const postalProvinces = provincesForPostalCode(postal);
    const hit = (await geocode({ postalCode: postal })) ??
      (await locateFromTutors({ postalCodePrefix: prefix }));
    return located(base, hit, {
      kind: "POSTAL_CODE",
      input: prefix,
      postalPrefix: prefix,
      placeProvince: hit?.province ?? postalProvinces[0] ?? null,
      provinceCode,
    });
  }

  if (params.city) {
    const cityName = String(params.city).replace(/\s+/g, " ").trim();
    const hit = (await geocode({ city: cityName, province: provinceCode ?? undefined })) ??
      (await locateFromTutors({ city: cityName, province: provinceCode }));
    return located(base, hit, {
      kind: "CITY",
      input: cityName,
      cityName,
      placeProvince: hit?.province ?? null,
      provinceCode,
    });
  }

  return base;
}

function located(base, hit, { kind, input, postalPrefix, cityName, placeProvince, provinceCode }) {
  const mismatch = provinceCode && placeProvince && placeProvince !== provinceCode ? placeProvince : null;
  if (!hit) {
    return { ...base, status: "UNRESOLVED", kind, input, postalPrefix, cityName, placeProvince, provinceMismatch: mismatch };
  }
  return {
    ...base,
    status: "RESOLVED",
    kind,
    input,
    coordinates: hit.coordinates,
    city: hit.city,
    placeProvince,
    source: hit.source ?? "GEOCODER",
    provinceMismatch: mismatch,
  };
}

/**
 * A place the geocoder does not know, located by the tutors who serve it:
 * the centre of their (already approximate) postal-area locations.
 */
async function locateFromTutors({ city, postalCodePrefix, province }) {
  const match = { isSearchable: true, "location.coordinates.1": { $exists: true } };
  if (postalCodePrefix) match.postalCodePrefix = postalCodePrefix;
  else if (city) match.city = new RegExp(`^${escapeRegex(city)}$`, "i");
  else return null;
  if (province) match.province = province;

  const docs = await TutorProfile.find(match).select("location city province").limit(50).lean();
  if (!docs.length) return null;
  const sum = docs.reduce(
    (acc, d) => [acc[0] + d.location.coordinates[0], acc[1] + d.location.coordinates[1]],
    [0, 0],
  );
  return {
    coordinates: coarsenCoordinates([sum[0] / docs.length, sum[1] / docs.length]),
    city: docs[0].city,
    province: docs[0].province,
    source: "TUTOR_DATA",
  };
}

/** What the page may say about the location; never echoes a full postal code. */
function publicLocation(location) {
  return {
    status: location.status,
    kind: location.kind,
    input: location.input ?? null,
    city: location.city ?? null,
    province: location.placeProvince ?? null,
    provinceMismatch: location.provinceMismatch ?? null,
    source: location.source ?? null,
    radiusKm: location.radiusKm ?? null,
  };
}

/**
 * Facet counts for the filter rail, against the same resolved search (minus
 * availability, which is evaluated per tutor and would make every count a
 * calendar computation).
 */
export async function searchFacets(params) {
  const settings = await getSettings();
  const curriculum = await resolveCurriculum(params);
  const location = await resolveLocation(params, { settings, provinceCode: curriculum.provinceCode });
  const base = queryFor(params, curriculum, location);

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

  return withLiveAvailability(
    await attachAvailableWeekdays(
      docs.map((profile) => ({
        ...toPublicTutor(profile, profile.userId),
        isPromoted: promotedIds.has(String(profile._id)),
      })),
    ),
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
