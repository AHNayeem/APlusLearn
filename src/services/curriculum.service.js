import "server-only";
import { revalidatePath } from "next/cache";
import { Province, Grade, Subject, Course, TutorProfile, StudentProfile } from "@/models";
import { PAGE_SIZES, AUDIT_ACTIONS, GRADE_STAGES } from "@/constants";
import { NotFoundError, ConflictError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { slugify } from "@/lib/utils/slug";
import { escapeRegex } from "@/lib/security/sanitize";
import { recordAudit } from "./audit.service";
import { rebuildTaughtCourses, flattenTaughtCourses } from "@/lib/curriculum/taught";

/**
 * Canadian curriculum (§13).
 *
 * Reference data changes rarely and is read constantly (every search box,
 * every course page), so lookups are memoised per process with a short TTL.
 */

const REFERENCE_TTL_MS = 60_000;
const globalForCurriculum = globalThis;
const refCache = globalForCurriculum.__aplusCurriculum ?? new Map();
globalForCurriculum.__aplusCurriculum = refCache;

async function cached(key, loader) {
  const hit = refCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await loader();
  refCache.set(key, { value, expiresAt: Date.now() + REFERENCE_TTL_MS });
  return value;
}

/**
 * Forget every memoised curriculum read, and tell Next that pages rendered
 * from the curriculum are stale. The homepage and other public pages are
 * cached (ISR), and a province an administrator has just switched on must
 * not stay "coming soon" there for an hour (§6). Outside a Next request (a
 * script, the integration suite) there is nothing to revalidate.
 */
function invalidate() {
  refCache.clear();
  try {
    revalidatePath("/", "layout");
  } catch {
    // Not inside a request Next is rendering — nothing cached to drop.
  }
}

// --- Reads -----------------------------------------------------------------

export async function listProvinces({ activeOnly = true } = {}) {
  return cached(`provinces:${activeOnly}`, async () => {
    const query = activeOnly ? { isActive: true } : {};
    const docs = await Province.find(query).sort({ displayOrder: 1, name: 1 }).lean();
    return toPlain(docs);
  });
}

export async function getProvince(codeOrSlug) {
  const key = String(codeOrSlug).toUpperCase();
  return cached(`province:${key}`, async () => {
    const doc = await Province.findOne({
      $or: [{ code: key }, { slug: String(codeOrSlug).toLowerCase() }],
    }).lean();
    return doc ? toPlain(doc) : null;
  });
}

/**
 * The province codes a visitor is allowed to browse.
 *
 * `Province.isActive` is what the pickers and the homepage call "coming
 * soon", and until now that promise stopped at the picker: a course under a
 * deactivated province kept `Course.isActive: true` of its own, so it stayed
 * in `/courses` and its SEO landing page still rendered. Deactivating a
 * province is one click and cascading it onto every course underneath would
 * be a migration, so the gate lives on the read instead — one cached lookup,
 * invalidated by the same `invalidate()` every curriculum write already calls.
 *
 * It applies to the public view only (`activeOnly`), because an administrator
 * has to be able to see and edit the curriculum they are still building.
 */
export async function activeProvinceCodes() {
  return cached("provinceCodes:active", async () => {
    const docs = await Province.find({ isActive: true }).select("code").lean();
    return docs.map((p) => p.code);
  });
}

/**
 * The province a picker starts on when the visitor has not chosen one.
 *
 * Read from the data — the first *live* province in the administrator's
 * display order — never a literal. A deployment that launches another
 * province first, or reorders them, changes every picker's starting point
 * without a code change (§6). `null` when nothing is live yet.
 */
export async function defaultProvinceCode() {
  return cached("provinceCode:default", async () => {
    const doc = await Province.findOne({ isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .select("code")
      .lean();
    return doc?.code ?? null;
  });
}

/**
 * Grades of one province, in order.
 *
 * `activeOnly: false` is the administrator's view: a deactivated grade must
 * stay listed there, or it could never be switched back on (R28.10).
 */
export async function listGrades({ provinceCode, provinceId, activeOnly = true } = {}) {
  return cached(`grades:${provinceCode ?? provinceId ?? "all"}:${activeOnly}`, async () => {
    let id = provinceId;
    if (!id && provinceCode) {
      const province = await getProvince(provinceCode);
      if (!province) return [];
      id = province.id;
    }
    const query = activeOnly ? { isActive: true } : {};
    if (id) query.provinceId = id;
    const docs = await Grade.find(query).sort({ level: 1 }).lean();
    return toPlain(docs);
  });
}

/**
 * Subjects, optionally narrowed to the ones a province (and grade) actually
 * teaches.
 *
 * Subjects are a shared list, but a picker scoped to a province should only
 * offer what that province has courses for — otherwise choosing "Ontario,
 * Grade 3, Chemistry" is possible and finds nothing. Narrowing reads the
 * live courses, so it follows the curriculum as an administrator edits it.
 */
export async function listSubjects({ popularOnly = false, provinceCode, gradeSlug, activeOnly = true } = {}) {
  const key = `subjects:${popularOnly}:${provinceCode ?? "*"}:${gradeSlug ?? "*"}:${activeOnly}`;
  return cached(key, async () => {
    const query = activeOnly ? { isActive: true } : {};
    if (popularOnly) query.isPopular = true;
    if (provinceCode) {
      const courseQuery = { isActive: true, provinceCode: String(provinceCode).toUpperCase() };
      if (gradeSlug) courseQuery.gradeSlug = gradeSlug;
      query._id = { $in: await Course.distinct("subjectId", courseQuery) };
    }
    const docs = await Subject.find(query).sort({ displayOrder: 1, name: 1 }).lean();
    return toPlain(docs);
  });
}

export async function getSubject(slug) {
  return cached(`subject:${slug}`, async () => {
    const doc = await Subject.findOne({ slug }).lean();
    return doc ? toPlain(doc) : null;
  });
}

/**
 * Course search (§13).
 *
 * One query builder serves the browse page, the public API and the admin
 * table, so a filter added here is available everywhere at once. Matches on
 * name *and* code so "advanced functions" and "MHF4U" both find the same
 * course.
 */
const COURSE_SORTS = {
  RELEVANCE: { isPopular: -1, gradeLevel: -1, name: 1 },
  TUTORS: { tutorCount: -1, isPopular: -1, name: 1 },
  GRADE_DESC: { gradeLevel: -1, subjectName: 1, name: 1 },
  GRADE_ASC: { gradeLevel: 1, subjectName: 1, name: 1 },
  NAME: { name: 1, gradeLevel: -1 },
  CODE: { code: 1, name: 1 },
};

/**
 * Stage and explicit grade bounds both constrain the same denormalised
 * `gradeLevel`, so they are resolved together: stages contribute a set of
 * levels, the bounds then trim it. Without a stage the bounds become a plain
 * range so the index is still usable.
 */
function gradeLevelFilter({ stage, minGrade, maxGrade }) {
  const min = minGrade ?? Number.NEGATIVE_INFINITY;
  const max = maxGrade ?? Number.POSITIVE_INFINITY;

  if (stage?.length) {
    const levels = new Set();
    for (const value of stage) {
      const range = GRADE_STAGES.find((s) => s.value === value);
      if (!range) continue;
      for (let level = range.minLevel; level <= range.maxLevel; level += 1) {
        if (level >= min && level <= max) levels.add(level);
      }
    }
    // An impossible combination must return nothing rather than everything.
    return { $in: [...levels].sort((a, b) => a - b) };
  }

  if (minGrade === undefined && maxGrade === undefined) return null;
  const range = {};
  if (minGrade !== undefined) range.$gte = minGrade;
  if (maxGrade !== undefined) range.$lte = maxGrade;
  return range;
}

function buildCourseQuery({
  q, province, grade, subject, stage, stream, minGrade, maxGrade,
  hasTutors, hasCode, popular, activeOnly = true,
} = {}) {
  const query = {};
  if (activeOnly) query.isActive = true;
  if (province) query.provinceCode = String(province).toUpperCase();
  if (grade) query.gradeSlug = grade;
  if (subject) query.subjectSlug = subject;
  if (popular !== undefined) query.isPopular = popular;
  if (stream?.length) query.stream = { $in: stream };

  if (hasTutors !== undefined) query.tutorCount = hasTutors ? { $gt: 0 } : { $not: { $gt: 0 } };
  // `code` is absent on elementary courses, so "has a code" is a type test
  // rather than an `$exists` check (see the partial index on the model).
  if (hasCode !== undefined) {
    query.code = hasCode ? { $type: "string" } : { $not: { $type: "string" } };
  }

  const levels = gradeLevelFilter({ stage, minGrade, maxGrade });
  if (levels) query.gradeLevel = levels;

  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    query.$or = [{ name: pattern }, { code: pattern }, { description: pattern }];
  }

  return query;
}

export async function listCourses(params = {}) {
  const { page = 1, pageSize, sort = "RELEVANCE" } = params;
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = buildCourseQuery(params);

  // The public list shows only what a visitor may actually browse. An
  // explicit `province` filter is narrowed rather than replaced, so asking
  // for a province that is not live returns nothing instead of everything.
  if (params.activeOnly !== false) {
    const codes = await activeProvinceCodes();
    query.provinceCode = query.provinceCode
      ? { $in: codes.filter((c) => c === query.provinceCode) }
      : { $in: codes };
  }

  const [items, total] = await Promise.all([
    Course.find(query)
      .sort(COURSE_SORTS[sort] ?? COURSE_SORTS.RELEVANCE)
      .skip((page - 1) * size)
      .limit(size)
      .lean(),
    Course.countDocuments(query),
  ]);

  return {
    items: toPlain(items),
    total,
    page,
    pageSize: size,
    totalPages: Math.max(1, Math.ceil(total / size)),
  };
}

/**
 * Counts for the browse page's filter rail (§13, §14).
 *
 * Each facet is counted against the search *minus its own dimension*, so
 * ticking one grade doesn't zero out every other grade's count — the numbers
 * answer "what would I get if I picked this instead", which is what a filter
 * rail is for.
 */
export async function courseFacets(params = {}) {
  const matchWithout = (...keys) =>
    buildCourseQuery({
      ...params,
      ...Object.fromEntries(keys.map((key) => [key, undefined])),
    });

  const [grades, subjects, streams, totals] = await Promise.all([
    Course.aggregate([
      { $match: matchWithout("grade", "stage", "minGrade", "maxGrade") },
      { $group: { _id: { slug: "$gradeSlug", level: "$gradeLevel" }, count: { $sum: 1 } } },
    ]),
    Course.aggregate([
      { $match: matchWithout("subject") },
      { $group: { _id: { slug: "$subjectSlug", name: "$subjectName" }, count: { $sum: 1 } } },
    ]),
    Course.aggregate([
      { $match: matchWithout("stream") },
      { $group: { _id: "$stream", count: { $sum: 1 } } },
    ]),
    Course.aggregate([
      { $match: matchWithout("hasTutors", "hasCode", "popular") },
      {
        $group: {
          _id: null,
          courses: { $sum: 1 },
          withTutors: { $sum: { $cond: [{ $gt: ["$tutorCount", 0] }, 1, 0] } },
          withCode: { $sum: { $cond: [{ $eq: [{ $type: "$code" }, "string"] }, 1, 0] } },
          popular: { $sum: { $cond: ["$isPopular", 1, 0] } },
          tutors: { $sum: "$tutorCount" },
        },
      },
    ]),
  ]);

  const gradeCounts = {};
  const stageCounts = {};
  for (const row of grades) {
    if (row._id.slug) gradeCounts[row._id.slug] = row.count;
    const stage = GRADE_STAGES.find(
      (s) => row._id.level >= s.minLevel && row._id.level <= s.maxLevel,
    );
    if (stage) stageCounts[stage.value] = (stageCounts[stage.value] ?? 0) + row.count;
  }

  return {
    grades: gradeCounts,
    stages: stageCounts,
    subjects: Object.fromEntries(
      subjects.filter((s) => s._id.slug).map((s) => [s._id.slug, s.count]),
    ),
    // Streams are free text on the model (provinces name them differently), so
    // the options come from the data rather than a hard-coded list.
    streams: streams
      .filter((s) => s._id)
      .map((s) => ({ value: s._id, count: s.count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    totals: totals[0]
      ? {
          courses: totals[0].courses,
          withTutors: totals[0].withTutors,
          withoutTutors: totals[0].courses - totals[0].withTutors,
          withCode: totals[0].withCode,
          popular: totals[0].popular,
          tutors: totals[0].tutors,
        }
      : { courses: 0, withTutors: 0, withoutTutors: 0, withCode: 0, popular: 0, tutors: 0 },
  };
}

export async function getCourseById(id) {
  const doc = await Course.findById(id).lean();
  return doc ? toPlain(doc) : null;
}

/**
 * A live course by its provincial code. Public callers (the SEO city pages)
 * go through here, so an inactive course — or one under a "coming soon"
 * province — resolves to nothing, exactly as `getCourseByPath` does.
 */
export async function getCourseByCode(code, provinceCode, { activeOnly = true } = {}) {
  const query = { code: String(code).toUpperCase() };
  if (activeOnly) {
    query.isActive = true;
    const codes = await activeProvinceCodes();
    const wanted = provinceCode ? String(provinceCode).toUpperCase() : null;
    query.provinceCode = wanted ? { $in: codes.filter((c) => c === wanted) } : { $in: codes };
  } else if (provinceCode) {
    query.provinceCode = String(provinceCode).toUpperCase();
  }
  const doc = await Course.findOne(query).lean();
  return doc ? toPlain(doc) : null;
}

/**
 * Resolve the SEO path /:province/:grade/:subject/:course (§29).
 *
 * Returns null for a province that is not live, which is what makes the
 * landing page 404 rather than advertise tutoring the platform is telling
 * everybody else is still "coming soon".
 */
export async function getCourseByPath({ province, grade, subject, course }) {
  const codes = await activeProvinceCodes();
  const query = { isActive: true };
  if (province) {
    const code = String(province).toUpperCase();
    if (!codes.includes(code)) return null;
    query.provinceCode = code;
  } else {
    // No province in the path is not a path this application builds, but a
    // caller that omits it still gets the public view rather than every one.
    query.provinceCode = { $in: codes };
  }
  if (grade) query.gradeSlug = grade;
  if (subject) query.subjectSlug = subject;

  // The last segment may be either a slug or a course code.
  const upper = String(course).toUpperCase();
  const doc = await Course.findOne({
    ...query,
    $or: [{ slug: String(course).toLowerCase() }, { code: upper }],
  }).lean();

  return doc ? toPlain(doc) : null;
}

/**
 * Courses flagged popular, for one province — or, with no province, across
 * every live one. There is no implicit province: a caller that means one
 * says which (§6).
 */
export async function popularCourses(limit = 8, provinceCode) {
  return cached(`popularCourses:${provinceCode ?? "*"}:${limit}`, async () => {
    const codes = await activeProvinceCodes();
    const scope = provinceCode
      ? codes.filter((code) => code === String(provinceCode).toUpperCase())
      : codes;
    const docs = await Course.find({ isActive: true, isPopular: true, provinceCode: { $in: scope } })
      .sort({ tutorCount: -1, name: 1 })
      .limit(limit)
      .lean();
    return toPlain(docs);
  });
}

/**
 * Autocomplete for the hero search and header (§12).
 *
 * Each suggestion carries the exact search parameters it stands for — a
 * course by its code (or by slug *and* grade when it has none, since a
 * codeless name like "English" exists in several grades), a subject by slug
 * — so picking one searches for precisely that, and the rest of the form
 * still applies. Matches names, codes and curriculum aliases ("math",
 * "calculus"), live provinces only.
 */
export async function suggest({ q, province, limit = 8 }) {
  const pattern = new RegExp(`^${escapeRegex(q)}`, "i");
  const contains = new RegExp(escapeRegex(q), "i");
  const aliasPrefix = new RegExp(`^${escapeRegex(slugify(q))}`);
  const codes = await activeProvinceCodes();
  const scope = province
    ? codes.filter((code) => code === String(province).toUpperCase())
    : codes;
  const courseQuery = {
    isActive: true,
    provinceCode: { $in: scope },
    $or: [{ name: contains }, { code: pattern }, { aliases: aliasPrefix }],
  };

  const [courses, subjects] = await Promise.all([
    Course.find(courseQuery)
      .sort({ isPopular: -1, tutorCount: -1, gradeLevel: -1 })
      .limit(limit)
      .select("name code slug subjectSlug gradeSlug gradeLevel provinceCode")
      .lean(),
    Subject.find({ isActive: true, $or: [{ name: contains }, { aliases: aliasPrefix }] })
      .limit(4)
      .select("name slug icon")
      .lean(),
  ]);

  return {
    courses: toPlain(courses).map((c) => {
      const params = c.code
        ? { courseCode: c.code, province: c.provinceCode }
        : { course: c.slug, grade: c.gradeSlug, province: c.provinceCode };
      return {
        type: "COURSE",
        id: c.id,
        label: c.code ? `${c.code} — ${c.name}` : c.name,
        sublabel: `Grade ${c.gradeLevel} · ${c.provinceCode}`,
        href: `/find-a-tutor?${new URLSearchParams(params).toString()}`,
        params,
        code: c.code,
        slug: c.slug,
      };
    }),
    subjects: toPlain(subjects).map((s) => {
      const params = { subject: s.slug, ...(province ? { province: String(province).toUpperCase() } : {}) };
      return {
        type: "SUBJECT",
        id: s.id,
        label: s.name,
        sublabel: "Subject",
        href: `/find-a-tutor?${new URLSearchParams(params).toString()}`,
        params,
        slug: s.slug,
      };
    }),
  };
}

/**
 * Full hierarchy for a curriculum picker in one round trip: the province,
 * its grades, and the subjects it has courses for. Without a province it
 * resolves the default one from the data.
 */
export async function getCurriculumTree(provinceCode) {
  const code = provinceCode ?? (await defaultProvinceCode());
  if (!code) return { province: null, grades: [], subjects: [] };
  const [province, grades, subjects] = await Promise.all([
    getProvince(code),
    listGrades({ provinceCode: code }),
    listSubjects({ provinceCode: code }),
  ]);
  return { province, grades, subjects };
}

// --- Admin writes ----------------------------------------------------------

export async function createProvince(input, actor) {
  const slug = slugify(input.name);
  const exists = await Province.findOne({ $or: [{ code: input.code }, { slug }] }).lean();
  if (exists) throw new ConflictError("That province already exists.");

  const doc = await Province.create({ ...input, slug });
  invalidate();
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.CURRICULUM_UPDATED,
    entityType: "Province",
    entityId: doc._id,
    metadata: { created: input.code },
  });
  return toPlain(doc);
}

export async function updateProvince(id, patch, actor) {
  const before = await Province.findById(id).lean();
  if (!before) throw new NotFoundError("That province no longer exists.");

  const update = compact(patch);
  if (update.name) update.slug = slugify(update.name);
  const aliases = withRetiredSlug(update.aliases ?? before.aliases, before.slug, update.slug);
  if (aliases) update.aliases = aliases;

  const doc = await Province.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after", runValidators: true }).lean();
  if (!doc) throw new NotFoundError("That province no longer exists.");

  // Courses carry the province code for search; a changed code has to reach
  // them and every tutor who teaches them, or search filters on a code that
  // no longer exists.
  if (doc.code !== before.code) {
    await Course.updateMany({ provinceId: id }, { $set: { provinceCode: doc.code } });
    await resyncTutorsTeaching({ provinceId: id });
  }

  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Province", entityId: id });
  return toPlain(doc);
}

export async function createGrade(input, actor) {
  const doc = await Grade.create({ ...input, slug: slugify(input.name) });
  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Grade", entityId: doc._id });
  return toPlain(doc);
}

export async function updateGrade(id, patch, actor) {
  const before = await Grade.findById(id).lean();
  if (!before) throw new NotFoundError("That grade no longer exists.");

  const update = compact(patch);
  if (update.name) update.slug = slugify(update.name);
  const aliases = withRetiredSlug(update.aliases ?? before.aliases, before.slug, update.slug);
  if (aliases) update.aliases = aliases;

  const doc = await Grade.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after", runValidators: true }).lean();
  if (!doc) throw new NotFoundError("That grade no longer exists.");

  // A rename changes the slug search and the course URLs use; a new level
  // changes the grade filter. Both are copied onto courses and tutors.
  if (doc.slug !== before.slug || doc.level !== before.level) {
    await Course.updateMany({ gradeId: id }, { $set: { gradeSlug: doc.slug, gradeLevel: doc.level } });
    await resyncTutorsTeaching({ gradeId: id });
  }

  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Grade", entityId: id });
  return toPlain(doc);
}

export async function createSubject(input, actor) {
  const doc = await Subject.create({ ...input, slug: slugify(input.name) });
  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Subject", entityId: doc._id });
  return toPlain(doc);
}

export async function updateSubject(id, patch, actor) {
  const before = await Subject.findById(id).lean();
  if (!before) throw new NotFoundError("That subject no longer exists.");

  const update = compact(patch);
  if (update.name) update.slug = slugify(update.name);
  const aliases = withRetiredSlug(update.aliases ?? before.aliases, before.slug, update.slug);
  if (aliases) update.aliases = aliases;

  const doc = await Subject.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after", runValidators: true }).lean();
  if (!doc) throw new NotFoundError("That subject no longer exists.");

  if (doc.slug !== before.slug || doc.name !== before.name) {
    await Course.updateMany({ subjectId: id }, { $set: { subjectSlug: doc.slug, subjectName: doc.name } });
    await resyncTutorsTeaching({ subjectId: id });
  }

  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Subject", entityId: id });
  return toPlain(doc);
}

/** Courses carry denormalised province/grade/subject fields for search. */
export async function createCourse(input, actor) {
  const [province, grade, subject] = await Promise.all([
    Province.findById(input.provinceId).lean(),
    Grade.findById(input.gradeId).lean(),
    Subject.findById(input.subjectId).lean(),
  ]);
  if (!province || !grade || !subject) {
    throw new NotFoundError("Choose a valid province, grade and subject.");
  }
  if (String(grade.provinceId) !== String(province._id)) {
    throw new BusinessRuleError("That grade belongs to a different province.", "GRADE_PROVINCE_MISMATCH");
  }

  const doc = await Course.create({
    ...input,
    slug: slugify(input.name),
    provinceCode: province.code,
    gradeSlug: grade.slug,
    gradeLevel: grade.level,
    subjectSlug: subject.slug,
    subjectName: subject.name,
  });

  invalidate();
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.CURRICULUM_UPDATED,
    entityType: "Course",
    entityId: doc._id,
    metadata: { created: doc.code ?? doc.name },
  });
  return toPlain(doc);
}

export async function updateCourse(id, patch, actor) {
  const before = await Course.findById(id).lean();
  if (!before) throw new NotFoundError("That course no longer exists.");

  const update = compact(patch);
  if (update.name) update.slug = slugify(update.name);
  const aliases = withRetiredSlug(update.aliases ?? before.aliases, before.slug, update.slug);
  if (aliases) update.aliases = aliases;

  const provinceId = update.provinceId ?? before.provinceId;
  if (update.gradeId) {
    const grade = await Grade.findById(update.gradeId).lean();
    if (!grade) throw new NotFoundError("Choose a valid grade.");
    if (String(grade.provinceId) !== String(provinceId)) {
      throw new BusinessRuleError("That grade belongs to a different province.", "GRADE_PROVINCE_MISMATCH");
    }
    update.gradeSlug = grade.slug;
    update.gradeLevel = grade.level;
  }
  if (update.subjectId) {
    const subject = await Subject.findById(update.subjectId).lean();
    if (!subject) throw new NotFoundError("Choose a valid subject.");
    update.subjectSlug = subject.slug;
    update.subjectName = subject.name;
  }
  if (update.provinceId) {
    const province = await Province.findById(update.provinceId).lean();
    if (!province) throw new NotFoundError("Choose a valid province.");
    update.provinceCode = province.code;
  }

  const doc = await Course.findByIdAndUpdate(id, { $set: update }, { returnDocument: "after", runValidators: true }).lean();
  if (!doc) throw new NotFoundError("That course no longer exists.");

  // Tutors copy the code and name onto their profiles, so a corrected code
  // or a renamed course is re-copied to every profile that teaches it.
  await resyncTutorsTeaching({ _id: id });

  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Course", entityId: id });
  return toPlain(doc);
}

/**
 * Keep a slug that a rename retired, so links to it still resolve (§32).
 * Returns the new alias list, or null when nothing changes.
 */
function withRetiredSlug(aliases = [], previousSlug, nextSlug) {
  const list = [...new Set((aliases ?? []).filter(Boolean))];
  if (nextSlug && previousSlug && nextSlug !== previousSlug && !list.includes(previousSlug)) {
    list.push(previousSlug);
  }
  return list.filter((alias) => alias !== nextSlug);
}

/**
 * Re-copy the curriculum onto every tutor profile that teaches a course
 * matching `courseFilter` (see lib/curriculum/taught.js). Each profile is
 * rebuilt from *all* of its courses, so one edit cannot leave a profile
 * half updated.
 */
async function resyncTutorsTeaching(courseFilter) {
  const affected = await Course.find(courseFilter).select("_id").lean();
  if (!affected.length) return { updated: 0 };

  const profiles = await TutorProfile.find({ courseIds: { $in: affected.map((c) => c._id) } })
    .select("courses")
    .lean();
  if (!profiles.length) return { updated: 0 };

  const courseIds = [...new Set(profiles.flatMap((p) => (p.courses ?? []).map((c) => String(c.courseId))))];
  const courses = await Course.find({ _id: { $in: courseIds } }).lean();
  const courseMap = new Map(courses.map((c) => [String(c._id), c]));

  const ops = profiles.map((profile) => {
    const taught = rebuildTaughtCourses(profile.courses ?? [], courseMap);
    return {
      updateOne: {
        filter: { _id: profile._id },
        update: { $set: { courses: taught, ...flattenTaughtCourses(taught) } },
      },
    };
  });
  await TutorProfile.bulkWrite(ops);
  return { updated: ops.length };
}

/**
 * Remove a province, grade or subject that nothing uses yet — a record
 * created by mistake. Anything referenced by a course, a learner or a
 * request is deactivated instead, which keeps history intact (R28.9–R28.11).
 */
export async function deleteProvince(id, actor) {
  const province = await Province.findById(id).lean();
  if (!province) throw new NotFoundError("That province no longer exists.");
  const [grades, courses, learners] = await Promise.all([
    Grade.countDocuments({ provinceId: id }),
    Course.countDocuments({ provinceId: id }),
    StudentProfile.countDocuments({ provinceCode: province.code }),
  ]);
  if (grades + courses + learners > 0) {
    throw new ConflictError("This province has grades, courses or learners. Deactivate it instead of deleting it.");
  }
  await Province.deleteOne({ _id: id });
  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Province", entityId: id, metadata: { deleted: province.code } });
  return { deleted: true };
}

export async function deleteGrade(id, actor) {
  const grade = await Grade.findById(id).lean();
  if (!grade) throw new NotFoundError("That grade no longer exists.");
  const [courses, learners] = await Promise.all([
    Course.countDocuments({ gradeId: id }),
    StudentProfile.countDocuments({ gradeId: id }),
  ]);
  if (courses + learners > 0) {
    throw new ConflictError("This grade has courses or learners. Deactivate it instead of deleting it.");
  }
  await Grade.deleteOne({ _id: id });
  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Grade", entityId: id, metadata: { deleted: grade.slug } });
  return { deleted: true };
}

export async function deleteSubject(id, actor) {
  const subject = await Subject.findById(id).lean();
  if (!subject) throw new NotFoundError("That subject no longer exists.");
  const [courses, learners] = await Promise.all([
    Course.countDocuments({ subjectId: id }),
    StudentProfile.countDocuments({ subjectsOfInterest: id }),
  ]);
  if (courses + learners > 0) {
    throw new ConflictError("This subject has courses or learners. Deactivate it instead of deleting it.");
  }
  await Subject.deleteOne({ _id: id });
  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Subject", entityId: id, metadata: { deleted: subject.slug } });
  return { deleted: true };
}

export async function deleteCourse(id, actor) {
  const inUse = await TutorProfile.countDocuments({ courseIds: id });
  if (inUse > 0) {
    throw new ConflictError(
      `${inUse} tutor${inUse === 1 ? "" : "s"} teach this course. Deactivate it instead of deleting it.`,
    );
  }
  await Course.deleteOne({ _id: id });
  invalidate();
  await recordAudit({ actor, action: AUDIT_ACTIONS.CURRICULUM_UPDATED, entityType: "Course", entityId: id, metadata: { deleted: true } });
  return { deleted: true };
}

/** Keep `tutorCount` on courses accurate for course landing pages. */
export async function refreshCourseTutorCounts() {
  const counts = await TutorProfile.aggregate([
    { $match: { isSearchable: true } },
    { $unwind: "$courseIds" },
    { $group: { _id: "$courseIds", count: { $sum: 1 } } },
  ]);

  const countMap = new Map(counts.map((c) => [String(c._id), c.count]));
  const courses = await Course.find({}).select("_id tutorCount").lean();

  const ops = courses
    .map((course) => ({ course, next: countMap.get(String(course._id)) ?? 0 }))
    .filter(({ course, next }) => (course.tutorCount ?? 0) !== next)
    .map(({ course, next }) => ({
      updateOne: { filter: { _id: course._id }, update: { $set: { tutorCount: next } } },
    }));

  if (ops.length) await Course.bulkWrite(ops);
  invalidate();
  return { updated: ops.length };
}
