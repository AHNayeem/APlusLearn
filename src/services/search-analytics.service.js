import "server-only";
import { SearchEvent } from "@/models";
import { SEARCH_ANALYTICS } from "@/constants";
import { resolveRange } from "@/lib/analytics/range";
import { addDays } from "@/lib/utils/time";

/**
 * What families search for (§28, R28.31).
 *
 * `recordSearch` is called once per search a visitor actually ran (the first
 * page, not a prefetch, not paging); `searchDemand` aggregates the stored
 * events in MongoDB for the admin analytics page. Neither ever sees who
 * searched — see `models/SearchEvent.js` for what is kept and what is not.
 */

/** The filter groups worth reporting on, by the search parameter that sets them. */
const FILTER_PARAMS = {
  availability: ["availability", "date", "time"],
  price: ["minPrice", "maxPrice"],
  rating: ["minRating"],
  experience: ["minExperience"],
  qualifications: ["qualifications"],
  verification: ["verified"],
  distance: ["distanceKm"],
  languages: ["languages"],
};

function present(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== "";
}

/**
 * Build the stored event from the validated search parameters and what the
 * search resolved them to. Pure, so the "nothing personal" rule is testable.
 */
export function searchEventFrom(params, result, now = new Date()) {
  const resolved = result?.resolved ?? {};
  const course = resolved.course ?? null;
  const subject = resolved.subject ?? null;
  const grade = resolved.grade ?? null;

  const filters = Object.entries(FILTER_PARAMS)
    .filter(([, keys]) => keys.some((key) => present(params?.[key])))
    .map(([name]) => name);

  const locationKind = params?.postalCode ? "POSTAL_CODE" : params?.city ? "CITY" : "NONE";

  return {
    provinceCode: course?.provinceCode ?? params?.province ?? undefined,
    gradeSlug: grade?.slug ?? course?.gradeSlug ?? undefined,
    gradeLevel: grade?.level ?? course?.gradeLevel ?? undefined,
    subjectSlug: subject?.slug ?? course?.subjectSlug ?? undefined,
    subjectName: subject?.name ?? course?.subjectName ?? undefined,
    courseId: course?.id ?? course?._id ?? undefined,
    courseCode: course?.code ?? undefined,
    courseName: course?.name ?? undefined,
    queryKind: resolved.queryKind ?? "NONE",
    mode: params?.mode && params.mode !== "ANY" ? params.mode : "ANY",
    locationKind,
    locationResolved: locationKind !== "NONE" && resolved.location?.status === "RESOLVED",
    // Only a place the geocoder or the data recognised — never the raw text.
    city: resolved.location?.status === "RESOLVED" ? resolved.location.city ?? undefined : undefined,
    filters,
    resultCount: Math.max(0, Number(result?.total) || 0),
    createdAt: now,
    expiresAt: addDays(now, SEARCH_ANALYTICS.retentionDays),
  };
}

/**
 * Store one search. Never throws: analytics must not be able to break the
 * search it is describing.
 */
export async function recordSearch(params, result) {
  try {
    if ((params?.page ?? 1) > 1) return null;
    return await SearchEvent.create(searchEventFrom(params, result));
  } catch (error) {
    console.error(`[search-analytics] could not record a search: ${error.message}`);
    return null;
  }
}

/**
 * Search demand over a half-open period.
 *
 * @returns {Promise<{
 *   totalSearches: number,
 *   zeroResultSearches: number,
 *   topSubjects: {slug: string, name: string, count: number}[],
 *   topCourses: {courseId: string, code: string|null, name: string, provinceCode: string|null, count: number}[],
 *   topLocations: {city: string, provinceCode: string|null, count: number}[],
 *   byMode: {ONLINE: number, IN_PERSON: number, ANY: number},
 *   byProvince: {code: string, count: number}[],
 *   byQueryKind: Record<string, number>,
 *   unresolvedLocations: number,
 *   range: {from: string, to: string},
 * }>}
 */
export async function searchDemand(options = {}) {
  const range = resolveRange(options);
  const limit = options.limit ?? SEARCH_ANALYTICS.topLimit;
  const match = { createdAt: { $gte: range.from, $lt: range.to } };

  const [facets] = await SearchEvent.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              zero: { $sum: { $cond: [{ $eq: ["$resultCount", 0] }, 1, 0] } },
              unresolved: {
                $sum: {
                  $cond: [
                    { $and: [{ $ne: ["$locationKind", "NONE"] }, { $eq: ["$locationResolved", false] }] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        subjects: [
          { $match: { subjectSlug: { $type: "string" } } },
          { $group: { _id: "$subjectSlug", name: { $last: "$subjectName" }, count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
          { $limit: limit },
        ],
        courses: [
          { $match: { courseId: { $type: "objectId" } } },
          {
            $group: {
              _id: "$courseId",
              code: { $last: "$courseCode" },
              name: { $last: "$courseName" },
              provinceCode: { $last: "$provinceCode" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1, _id: 1 } },
          { $limit: limit },
        ],
        locations: [
          { $match: { city: { $type: "string" } } },
          { $group: { _id: { city: "$city", province: "$provinceCode" }, count: { $sum: 1 } } },
          { $sort: { count: -1, "_id.city": 1 } },
          { $limit: limit },
        ],
        modes: [{ $group: { _id: "$mode", count: { $sum: 1 } } }],
        provinces: [
          { $match: { provinceCode: { $type: "string" } } },
          { $group: { _id: "$provinceCode", count: { $sum: 1 } } },
          { $sort: { count: -1, _id: 1 } },
        ],
        kinds: [{ $group: { _id: "$queryKind", count: { $sum: 1 } } }],
      },
    },
  ]);

  const totals = facets?.totals?.[0] ?? { total: 0, zero: 0, unresolved: 0 };
  const byMode = { ONLINE: 0, IN_PERSON: 0, ANY: 0 };
  for (const row of facets?.modes ?? []) byMode[row._id ?? "ANY"] = row.count;

  return {
    totalSearches: totals.total,
    zeroResultSearches: totals.zero,
    unresolvedLocations: totals.unresolved,
    topSubjects: (facets?.subjects ?? []).map((row) => ({
      slug: row._id,
      name: row.name ?? row._id,
      count: row.count,
    })),
    topCourses: (facets?.courses ?? []).map((row) => ({
      courseId: String(row._id),
      code: row.code ?? null,
      name: row.name ?? "",
      provinceCode: row.provinceCode ?? null,
      count: row.count,
    })),
    topLocations: (facets?.locations ?? []).map((row) => ({
      city: row._id.city,
      provinceCode: row._id.province ?? null,
      count: row.count,
    })),
    byMode,
    byProvince: (facets?.provinces ?? []).map((row) => ({ code: row._id, count: row.count })),
    byQueryKind: Object.fromEntries((facets?.kinds ?? []).map((row) => [row._id ?? "NONE", row.count])),
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}
