import "server-only";
import { TutorProfile, Province, Course } from "@/models";
import { connectToDatabase } from "@/lib/db/connect";
import { GRADE_STAGES } from "@/constants";

/**
 * Facts the marketing pages state, read from the marketplace itself (§12, §33).
 *
 * "Most tutors charge between $45 and $85" and "the complete curriculum" were
 * sentences somebody wrote once. They were true of nothing in particular, and
 * the first tutor who set a different rate made them false. Everything here is
 * measured from the same records search reads, so a figure a page quotes is a
 * figure a visitor could check by searching.
 *
 * Every reader returns `null` rather than a guess when there is too little to
 * say — the page then words the claim without a number instead of inventing
 * one.
 */

/**
 * Below this many published rates a "typical range" is an anecdote, not a
 * statistic: the middle half of four tutors is two people. A statistical
 * floor, not a business rule — it decides whether a sentence can be written,
 * not what anybody pays.
 */
export const MIN_RATE_SAMPLE = 5;

/**
 * The middle half of published hourly rates — the 25th to 75th percentile —
 * among tutors a visitor can actually find.
 *
 * Nearest-rank on an index-ordered read: two single-document lookups at the
 * two ranks, so the cost does not grow with the marketplace. The base rate is
 * the one measured, because it is the rate on the profile; a per-course
 * override is the tutor's exception, not their price.
 *
 * Optional filters narrow the population the same way search does:
 * `provinceCode`, `courseId`, `subjectSlug`, or a `minGradeLevel`–`maxGradeLevel`
 * band (any taught grade inside it counts).
 *
 * @returns {Promise<{ lowCents: number, highCents: number, sampleSize: number } | null>}
 */
export async function hourlyRateRange({
  provinceCode, courseId, subjectSlug, minGradeLevel, maxGradeLevel,
} = {}) {
  await connectToDatabase();

  const filter = { isSearchable: true, hourlyRateCents: { $gt: 0 } };
  if (provinceCode) filter.provinceCodes = String(provinceCode).toUpperCase();
  if (courseId) filter.courseIds = courseId;
  if (subjectSlug) filter.subjectSlugs = subjectSlug;
  if (Number.isFinite(minGradeLevel) || Number.isFinite(maxGradeLevel)) {
    filter.gradeLevels = {
      $elemMatch: {
        ...(Number.isFinite(minGradeLevel) ? { $gte: minGradeLevel } : {}),
        ...(Number.isFinite(maxGradeLevel) ? { $lte: maxGradeLevel } : {}),
      },
    };
  }

  const sampleSize = await TutorProfile.countDocuments(filter);
  if (sampleSize < MIN_RATE_SAMPLE) return null;

  const atRank = async (quantile) => {
    const doc = await TutorProfile.findOne(filter)
      .sort({ hourlyRateCents: 1, _id: 1 })
      .skip(Math.floor(quantile * (sampleSize - 1)))
      .select("hourlyRateCents")
      .lean();
    return doc?.hourlyRateCents ?? null;
  };

  const [lowCents, highCents] = await Promise.all([atRank(0.25), atRank(0.75)]);
  if (lowCents == null || highCents == null) return null;
  return { lowCents, highCents, sampleSize };
}

/**
 * The same range for each grade stage the course browser uses
 * (`GRADE_STAGES`), for the pricing page. A stage with too few tutors comes
 * back with `range: null` and is shown as such, not dropped — "not enough
 * tutors yet" is information too.
 */
export async function hourlyRateRangesByStage({ provinceCode } = {}) {
  return Promise.all(
    GRADE_STAGES.map(async (stage) => ({
      ...stage,
      range: await hourlyRateRange({
        provinceCode,
        minGradeLevel: stage.minLevel,
        maxGradeLevel: stage.maxLevel,
      }),
    })),
  );
}

/**
 * What the catalogue actually covers, by live province.
 *
 * "Live" is `Province.isActive`, the same rule `activeProvinceCodes()` applies
 * to every public read, so this never describes a province a visitor cannot
 * browse. `comingSoon` counts the provinces an administrator has added but not
 * switched on.
 *
 * @returns {Promise<{ provinces: Array<{ code, name, usesCourseCodes, courseCount, minGradeLevel, maxGradeLevel }>, courseCount: number, comingSoon: number }>}
 */
export async function curriculumCoverage() {
  await connectToDatabase();

  const [live, comingSoon] = await Promise.all([
    Province.find({ isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .select("code name usesCourseCodes")
      .lean(),
    Province.countDocuments({ isActive: false }),
  ]);

  const codes = live.map((p) => p.code);
  const counts = codes.length
    ? await Course.aggregate([
        { $match: { isActive: true, provinceCode: { $in: codes } } },
        {
          $group: {
            _id: "$provinceCode",
            courseCount: { $sum: 1 },
            minGradeLevel: { $min: "$gradeLevel" },
            maxGradeLevel: { $max: "$gradeLevel" },
          },
        },
      ])
    : [];
  const byCode = new Map(counts.map((row) => [row._id, row]));

  const provinces = live.map((p) => ({
    code: p.code,
    name: p.name,
    usesCourseCodes: Boolean(p.usesCourseCodes),
    courseCount: byCode.get(p.code)?.courseCount ?? 0,
    minGradeLevel: byCode.get(p.code)?.minGradeLevel ?? null,
    maxGradeLevel: byCode.get(p.code)?.maxGradeLevel ?? null,
  }));

  return {
    provinces,
    courseCount: provinces.reduce((sum, p) => sum + p.courseCount, 0),
    comingSoon,
  };
}

/**
 * Both, for a page that quotes both — never throws. A marketing page must not
 * fail because a count could not be taken; it falls back to wording without
 * the number.
 */
export async function marketplaceFacts() {
  const [rateRange, coverage] = await Promise.all([
    hourlyRateRange().catch(() => null),
    curriculumCoverage().catch(() => null),
  ]);
  return { rateRange, coverage };
}
