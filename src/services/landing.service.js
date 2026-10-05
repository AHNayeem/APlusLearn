import "server-only";
import mongoose from "mongoose";
import { Province, Grade, Subject, Course, TutorProfile } from "@/models";
import { connectToDatabase } from "@/lib/db/connect";
import { CITY_CENTROIDS } from "@/lib/geo";
import { toPlain } from "@/lib/utils/serialize";
import { escapeRegex } from "@/lib/security/sanitize";

/**
 * Data access for the public SEO landing pages (§32).
 *
 * Every page this serves — a province, a province + subject, a grade +
 * subject, a course, a topic + city — starts from a URL segment somebody
 * typed or a search engine remembered. This module turns those segments into
 * curriculum records, read from the database and nowhere else, and says for
 * each one whether the URL that reached it was the canonical spelling:
 *
 *   - a segment may be the record's slug, one of its `aliases` ("math" for
 *     Mathematics, a slug retired by a rename), or — for a province — its
 *     code, and for a course its provincial course code;
 *   - only *live* records resolve: an inactive province ("coming soon"), an
 *     inactive grade, subject or course, and a combination the curriculum
 *     does not contain all come back `null`, which the page turns into a 404;
 *   - `canonical: false` means the page should permanently redirect to the
 *     path built from the records' own slugs.
 *
 * Nothing here knows the name of a province, a city or a course. A deployment
 * that switches on another province, renames a subject or adds an alias gets
 * working landing pages for it without a code change.
 */

/** A URL segment as it will be compared: decoded, trimmed, lower-case. */
export function normaliseSegment(value) {
  let text = String(value ?? "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Already decoded, or malformed — compare it as it is.
  }
  text = text.trim().toLowerCase();
  // Slugs, aliases and course codes are plain path characters. Anything else
  // cannot name a record, so it is refused before it reaches a query.
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(text) ? text : null;
}

/** "Richmond Hill" -> "richmond-hill": how a city appears in a URL. */
export function citySlug(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The canonical last segment of a course URL: its code, else its slug. */
export function courseSegment(course) {
  return course.code ? String(course.code).toLowerCase() : course.slug;
}

/** `/ontario/grade-12/mathematics/mhf4u`, from the stored records. */
export function coursePath(provinceSlug, course) {
  return `/${provinceSlug}/${course.gradeSlug}/${course.subjectSlug}/${courseSegment(course)}`;
}

function matchesSlugOrAlias(segment) {
  return { $or: [{ slug: segment }, { aliases: segment }] };
}

// --- Curriculum segments ----------------------------------------------------

/**
 * A live province from its slug, an alias, or its code.
 * @returns {Promise<{ province: object, canonical: boolean } | null>}
 */
export async function resolveProvince(raw) {
  const segment = normaliseSegment(raw);
  if (!segment) return null;
  await connectToDatabase();

  const doc = await Province.findOne({
    isActive: true,
    $or: [{ slug: segment }, { aliases: segment }, { code: segment.toUpperCase() }],
  }).lean();
  if (!doc) return null;
  return { province: toPlain(doc), canonical: raw === doc.slug };
}

/** A live grade of `province`, by slug or alias. */
export async function resolveGrade(province, raw) {
  const segment = normaliseSegment(raw);
  if (!segment || !province) return null;
  await connectToDatabase();

  const doc = await Grade.findOne({
    provinceId: province.id,
    isActive: true,
    ...matchesSlugOrAlias(segment),
  }).lean();
  if (!doc) return null;
  return { grade: toPlain(doc), canonical: raw === doc.slug };
}

/**
 * A live subject by slug or alias — but only one the province (and grade,
 * when given) actually has live courses in. A subject the curriculum does not
 * teach there would be an empty page, and an empty page is a 404.
 */
export async function resolveSubject(raw, { provinceCode, gradeId } = {}) {
  const segment = normaliseSegment(raw);
  if (!segment) return null;
  await connectToDatabase();

  const doc = await Subject.findOne({ isActive: true, ...matchesSlugOrAlias(segment) }).lean();
  if (!doc) return null;

  if (provinceCode) {
    const courseQuery = { isActive: true, provinceCode, subjectId: doc._id };
    if (gradeId) courseQuery.gradeId = gradeId;
    if (!(await Course.exists(courseQuery))) return null;
  }
  return { subject: toPlain(doc), canonical: raw === doc.slug };
}

/**
 * The full course path `/:province/:grade/:subject/:course` (R32.7).
 *
 * Each segment resolves on its own terms — province by slug, alias or code;
 * grade and subject by slug or alias; the course by slug, alias or course
 * code — and the course must then belong to that province, grade and subject.
 * A path whose parts each exist but do not belong together is a 404, not a
 * guess.
 *
 * @returns {Promise<{ province, grade, subject, course, canonicalPath: string, canonical: boolean } | null>}
 */
export async function resolveCoursePath({ province: p, grade: g, subject: s, course: c }) {
  const provinceHit = await resolveProvince(p);
  if (!provinceHit) return null;
  const { province } = provinceHit;

  const gradeHit = await resolveGrade(province, g);
  if (!gradeHit) return null;
  const subjectHit = await resolveSubject(s, { provinceCode: province.code, gradeId: gradeHit.grade.id });
  if (!subjectHit) return null;

  const segment = normaliseSegment(c);
  if (!segment) return null;

  const doc = await Course.findOne({
    isActive: true,
    provinceId: province.id,
    gradeId: gradeHit.grade.id,
    subjectId: subjectHit.subject.id,
    $or: [{ code: segment.toUpperCase() }, { slug: segment }, { aliases: segment }],
  })
    // A code is the most specific spelling, so it wins over a slug or alias
    // that happens to match another course in the same grade and subject.
    .sort({ code: -1, isPopular: -1, tutorCount: -1 })
    .lean();
  if (!doc) return null;

  const course = toPlain(doc);
  const canonicalPath = coursePath(province.slug, course);
  return {
    province,
    grade: gradeHit.grade,
    subject: subjectHit.subject,
    course,
    canonicalPath,
    canonical: `/${p}/${g}/${s}/${c}` === canonicalPath,
  };
}

/**
 * The second segment under a province: a grade (`/ontario/grade-12`) or a
 * subject (`/ontario/math`). Grades are tried first because their slugs are
 * province-scoped; a subject only resolves where the province teaches it.
 *
 * @returns {Promise<{ kind: "GRADE"|"SUBJECT", province, grade?, subject?, canonicalPath, canonical } | null>}
 */
export async function resolveProvinceSection({ province: p, section }) {
  const provinceHit = await resolveProvince(p);
  if (!provinceHit) return null;
  const { province } = provinceHit;

  const gradeHit = await resolveGrade(province, section);
  if (gradeHit) {
    // A grade with no live course in it would render an empty page.
    const hasCourses = await Course.exists({ isActive: true, provinceId: province.id, gradeId: gradeHit.grade.id });
    if (!hasCourses) return null;
    const canonicalPath = `/${province.slug}/${gradeHit.grade.slug}`;
    return {
      kind: "GRADE",
      province,
      grade: gradeHit.grade,
      canonicalPath,
      canonical: provinceHit.canonical && gradeHit.canonical,
    };
  }

  const subjectHit = await resolveSubject(section, { provinceCode: province.code });
  if (!subjectHit) return null;
  const canonicalPath = `/${province.slug}/${subjectHit.subject.slug}`;
  return {
    kind: "SUBJECT",
    province,
    subject: subjectHit.subject,
    canonicalPath,
    canonical: provinceHit.canonical && subjectHit.canonical,
  };
}

/** `/ontario/grade-12/mathematics` — a grade and a subject it has courses in. */
export async function resolveGradeSubject({ province: p, grade: g, subject: s }) {
  const provinceHit = await resolveProvince(p);
  if (!provinceHit) return null;
  const { province } = provinceHit;
  const gradeHit = await resolveGrade(province, g);
  if (!gradeHit) return null;
  const subjectHit = await resolveSubject(s, { provinceCode: province.code, gradeId: gradeHit.grade.id });
  if (!subjectHit) return null;

  const canonicalPath = `/${province.slug}/${gradeHit.grade.slug}/${subjectHit.subject.slug}`;
  return {
    province,
    grade: gradeHit.grade,
    subject: subjectHit.subject,
    canonicalPath,
    canonical: provinceHit.canonical && gradeHit.canonical && subjectHit.canonical,
  };
}

// --- Topic + city pages (/tutors/:topic/:city) -------------------------------

/**
 * A city named in a URL, without inventing one (R32.3, R32.6).
 *
 * The bundled centroid table is the list of places search can measure
 * distance from. A city outside it is still a real page when a searchable
 * tutor gives it as their own city — the page then lists by that name. A
 * segment that is neither is a 404: there is no "nearest big city" fallback,
 * because a page titled with one place and filled with tutors from another is
 * the thing a visitor searching "near me" least wants.
 *
 * @returns {Promise<{ name: string, provinceCode: string|null, coordinates: number[]|null, slug: string } | null>}
 */
export async function resolveCity(raw) {
  const segment = normaliseSegment(raw);
  if (!segment) return null;

  const key = segment.replace(/-/g, " ");
  const known = CITY_CENTROIDS[key] ?? CITY_CENTROIDS[key.replace(/\s+/g, "")];
  if (known) {
    return {
      name: known.city,
      provinceCode: known.province,
      coordinates: known.coordinates,
      slug: citySlug(known.city),
    };
  }

  await connectToDatabase();
  // Hyphens in the URL stand for spaces or hyphens in the stored name.
  const pattern = new RegExp(`^${key.split(" ").map(escapeRegex).join("[\\s-]+")}$`, "i");
  const doc = await TutorProfile.findOne({ isSearchable: true, city: pattern })
    .select("city province provinceCodes")
    .lean();
  if (!doc?.city) return null;

  return {
    name: doc.city,
    provinceCode: doc.province ?? doc.provinceCodes?.[0] ?? null,
    coordinates: null,
    slug: citySlug(doc.city),
  };
}

/**
 * What a visitor wants taught, from the first segment of `/tutors/:topic/:city`.
 *
 * In order: a provincial course code (`mhf4u`), a grade + subject
 * (`grade-12-math`), a subject (`math`, `mathematics`), a course slug or alias
 * (`calculus`). The province — from the city — decides between same-named
 * records in different provinces ("calculus" is a different course in each).
 *
 * @returns {Promise<{ kind: "COURSE"|"SUBJECT"|"GRADE_SUBJECT", course?, subject?, grade?, provinceCode: string, slug: string, canonical: boolean } | null>}
 */
export async function resolveTopic(raw, { provinceCode } = {}) {
  const segment = normaliseSegment(raw);
  if (!segment) return null;
  await connectToDatabase();

  const live = await Province.find({ isActive: true }).select("code").lean();
  const liveCodes = live.map((p) => p.code);
  const scope = provinceCode
    ? liveCodes.filter((code) => code === String(provinceCode).toUpperCase())
    : liveCodes;
  if (!scope.length) return null;

  const done = (hit) => ({ ...hit, canonical: raw === hit.slug });

  // 1. A course code.
  const byCode = await Course.findOne({
    isActive: true,
    provinceCode: { $in: scope },
    code: segment.toUpperCase(),
  }).lean();
  if (byCode) {
    const course = toPlain(byCode);
    return done({ kind: "COURSE", course, provinceCode: course.provinceCode, slug: courseSegment(course) });
  }

  // 2. Grade + subject: a grade slug or alias, a hyphen, a subject slug or alias.
  const grades = await Grade.find({
    isActive: true,
    provinceId: { $in: (await Province.find({ code: { $in: scope } }).select("_id").lean()).map((p) => p._id) },
  })
    .select("slug aliases level name provinceId")
    .lean();
  for (const grade of grades) {
    for (const prefix of [grade.slug, ...(grade.aliases ?? [])]) {
      if (!prefix || !segment.startsWith(`${prefix}-`)) continue;
      const subjectPart = segment.slice(prefix.length + 1);
      const subject = await Subject.findOne({ isActive: true, ...matchesSlugOrAlias(subjectPart) }).lean();
      if (!subject) continue;
      const course = await Course.findOne({
        isActive: true,
        provinceCode: { $in: scope },
        gradeId: grade._id,
        subjectId: subject._id,
      })
        .select("provinceCode")
        .lean();
      if (!course) continue;
      return done({
        kind: "GRADE_SUBJECT",
        grade: toPlain(grade),
        subject: toPlain(subject),
        provinceCode: course.provinceCode,
        slug: `${grade.slug}-${subject.slug}`,
      });
    }
  }

  // 3. A subject the province teaches.
  const subject = await Subject.findOne({ isActive: true, ...matchesSlugOrAlias(segment) }).lean();
  if (subject) {
    const course = await Course.findOne({ isActive: true, provinceCode: { $in: scope }, subjectId: subject._id })
      .select("provinceCode")
      .lean();
    if (course) {
      return done({ kind: "SUBJECT", subject: toPlain(subject), provinceCode: course.provinceCode, slug: subject.slug });
    }
  }

  // 4. A course by slug or alias.
  const byName = await Course.findOne({
    isActive: true,
    provinceCode: { $in: scope },
    ...matchesSlugOrAlias(segment),
  })
    .sort({ isPopular: -1, tutorCount: -1, gradeLevel: -1 })
    .lean();
  if (byName) {
    const course = toPlain(byName);
    return done({ kind: "COURSE", course, provinceCode: course.provinceCode, slug: courseSegment(course) });
  }

  return null;
}

/**
 * Both segments of `/tutors/:topic/:city`, checked against each other.
 *
 * The city decides the province; a topic that only exists in another
 * province ("MHF4U tutors in Vancouver") is a 404 rather than a page about
 * tutors who cannot be booked for it there.
 */
export async function resolveTopicCity({ topic: t, city: c }) {
  const city = await resolveCity(c);
  if (!city) return null;
  const topic = await resolveTopic(t, { provinceCode: city.provinceCode ?? undefined });
  if (!topic) return null;

  const canonicalPath = `/tutors/${topic.slug}/${city.slug}`;
  return {
    topic,
    city,
    canonicalPath,
    canonical: `/tutors/${t}/${c}` === canonicalPath,
  };
}

/**
 * `searchTutors` parameters for a resolved topic + city, shared by the page
 * and the tests so both ask the search page's own question.
 *
 * The province travels with the search only when the city is one search can
 * locate: the geocoder resolves an unlisted city to its province's largest
 * city, which is exactly the invented location these pages must not show.
 * Without it, an unlisted city falls through to the exact profile-city match.
 */
// The local list is in-person tutors for that place; the page lists online
// tutors in a section of their own, so a city page never presents a tutor
// from elsewhere as local.
export function topicSearchParams({ topic, city }, { mode = "IN_PERSON", withCity = true } = {}) {
  const params = { mode };
  const locatable = Boolean(city?.coordinates);

  if (topic.kind === "COURSE") {
    if (topic.course.code) params.courseCode = topic.course.code;
    else {
      params.course = topic.course.slug;
      params.grade = topic.course.gradeSlug;
    }
  } else {
    params.subject = topic.subject.slug;
    if (topic.kind === "GRADE_SUBJECT") params.grade = topic.grade.slug;
  }

  if (withCity && city) {
    params.city = city.name;
    if (locatable) params.province = topic.provinceCode;
  } else {
    params.province = topic.provinceCode;
  }
  return params;
}

// --- Landing-page reads ------------------------------------------------------

/**
 * Live subjects of a province with how many live courses each has there,
 * optionally within one grade, in the administrator's display order.
 */
export async function subjectsWithCourses({ provinceCode, gradeId } = {}) {
  await connectToDatabase();
  const match = { isActive: true, provinceCode };
  if (gradeId) match.gradeId = toObjectId(gradeId);

  const counts = await Course.aggregate([
    { $match: match },
    { $group: { _id: "$subjectId", courseCount: { $sum: 1 }, tutorCount: { $sum: "$tutorCount" } } },
  ]);
  if (!counts.length) return [];

  const byId = new Map(counts.map((row) => [String(row._id), row]));
  const subjects = await Subject.find({ _id: { $in: counts.map((row) => row._id) }, isActive: true })
    .sort({ displayOrder: 1, name: 1 })
    .lean();

  return toPlain(subjects).map((subject) => ({
    ...subject,
    courseCount: byId.get(subject.id)?.courseCount ?? 0,
    courseTutorCount: byId.get(subject.id)?.tutorCount ?? 0,
  }));
}

/** Live grades of a province that have at least one live course. */
export async function gradesWithCourses({ provinceId, subjectId } = {}) {
  await connectToDatabase();
  const match = { isActive: true, provinceId: toObjectId(provinceId) };
  if (subjectId) match.subjectId = toObjectId(subjectId);

  const gradeIds = await Course.distinct("gradeId", match);
  const grades = await Grade.find({ _id: { $in: gradeIds }, isActive: true }).sort({ level: 1 }).lean();
  return toPlain(grades);
}

/** Live courses in a province, narrowed by grade and/or subject. */
export async function landingCourses({ provinceCode, gradeId, subjectId, limit = 60 } = {}) {
  await connectToDatabase();
  const query = { isActive: true, provinceCode };
  if (gradeId) query.gradeId = toObjectId(gradeId);
  if (subjectId) query.subjectId = toObjectId(subjectId);

  const docs = await Course.find(query)
    .sort({ gradeLevel: 1, isPopular: -1, code: 1, name: 1 })
    .limit(limit)
    .lean();
  return toPlain(docs);
}

/**
 * Cities with searchable tutors for a topic, busiest first — the internal
 * links a landing page offers. Read from tutor profiles, so every link leads
 * to a page that lists somebody.
 */
export async function citiesWithTutors({ provinceCode, courseId, subjectSlug, gradeLevel, limit = 12 } = {}) {
  await connectToDatabase();
  const match = { isSearchable: true, lessonModes: "IN_PERSON", city: { $type: "string", $ne: "" } };
  if (provinceCode) match.provinceCodes = provinceCode;
  if (courseId) match.courseIds = toObjectId(courseId);
  if (subjectSlug) match.subjectSlugs = subjectSlug;
  if (Number.isFinite(gradeLevel)) match.gradeLevels = gradeLevel;

  const rows = await TutorProfile.aggregate([
    { $match: match },
    { $group: { _id: "$city", tutors: { $sum: 1 } } },
    { $sort: { tutors: -1, _id: 1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ name: row._id, slug: citySlug(row._id), tutorCount: row.tutors }));
}

/** Searchable tutors who teach in a province — the province page's headline number. */
export async function provinceTutorCount(provinceCode) {
  await connectToDatabase();
  return TutorProfile.countDocuments({ isSearchable: true, provinceCodes: provinceCode });
}

// --- Sitemap -----------------------------------------------------------------

/**
 * Every landing URL that resolves and has something on it (§29, §32).
 *
 * Built from the same rules the pages apply, so the sitemap cannot list a
 * page that would 404 or render empty:
 *
 *   - province pages for live provinces with at least one live course;
 *   - province + subject and grade + subject pages wherever a live course
 *     exists for that combination;
 *   - course pages for every live course under a live province;
 *   - topic + city pages only where a searchable tutor gives that city as
 *     their own and teaches that course code or subject there.
 *
 * @returns {Promise<Array<{ path: string, kind: string, lastModified?: Date, popular?: boolean }>>}
 */
export async function landingSitemapEntries({ courseLimit = 5000, cityLimit = 5000 } = {}) {
  await connectToDatabase();

  const provinces = await Province.find({ isActive: true }).select("code slug").lean();
  if (!provinces.length) return [];
  const slugByCode = new Map(provinces.map((p) => [p.code, p.slug]));
  const codes = [...slugByCode.keys()];

  const [courses, subjects, grades] = await Promise.all([
    Course.find({ isActive: true, provinceCode: { $in: codes } })
      .select("code slug gradeId gradeSlug subjectId subjectSlug provinceCode isPopular updatedAt")
      .limit(courseLimit)
      .lean(),
    Subject.find({ isActive: true }).select("slug").lean(),
    Grade.find({ isActive: true }).select("slug").lean(),
  ]);
  const liveSubjects = new Map(subjects.map((s) => [String(s._id), s.slug]));
  const liveGrades = new Map(grades.map((g) => [String(g._id), g.slug]));

  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    entries.push(entry);
  };

  for (const course of courses) {
    const provinceSlug = slugByCode.get(course.provinceCode);
    const gradeSlug = liveGrades.get(String(course.gradeId));
    const subjectSlug = liveSubjects.get(String(course.subjectId));
    // A course under an inactive grade or subject resolves to nothing.
    if (!gradeSlug || !subjectSlug) continue;

    add({ path: `/${provinceSlug}`, kind: "PROVINCE" });
    add({ path: `/${provinceSlug}/${subjectSlug}`, kind: "PROVINCE_SUBJECT" });
    add({ path: `/${provinceSlug}/${gradeSlug}/${subjectSlug}`, kind: "GRADE_SUBJECT" });
    add({
      path: coursePath(provinceSlug, { ...course, gradeSlug, subjectSlug }),
      kind: "COURSE",
      lastModified: course.updatedAt,
      popular: Boolean(course.isPopular),
    });
  }

  // Topic + city: from the tutors themselves, so every page lists somebody.
  const liveCourseCodes = new Map(
    courses.filter((c) => c.code).map((c) => [`${c.provinceCode}:${c.code}`, c]),
  );
  // In-person tutors only: a city page lists the tutors a family there can
  // meet, and online tutors have a section — not a city — of their own.
  const tutors = await TutorProfile.find({ isSearchable: true, lessonModes: "IN_PERSON", city: { $type: "string", $ne: "" } })
    .select("city province provinceCodes courseCodes subjectSlugs courses.provinceCode courses.code")
    .limit(cityLimit)
    .lean();

  const subjectSlugs = new Set(liveSubjects.values());
  const cities = new Map();
  for (const tutor of tutors) {
    const slug = citySlug(tutor.city);
    if (!cities.has(slug)) cities.set(slug, await resolveCity(slug));
    const city = cities.get(slug);
    if (!city?.provinceCode || !slugByCode.has(city.provinceCode)) continue;

    for (const taught of tutor.courses ?? []) {
      if (!taught.code || taught.provinceCode !== city.provinceCode) continue;
      if (!liveCourseCodes.has(`${taught.provinceCode}:${taught.code}`)) continue;
      add({ path: `/tutors/${taught.code.toLowerCase()}/${city.slug}`, kind: "COURSE_CITY" });
    }
    for (const slug of tutor.subjectSlugs ?? []) {
      if (!subjectSlugs.has(slug)) continue;
      const teachesHere = courses.some(
        (c) => c.provinceCode === city.provinceCode && liveSubjects.get(String(c.subjectId)) === slug,
      );
      if (teachesHere) add({ path: `/tutors/${slug}/${city.slug}`, kind: "SUBJECT_CITY" });
    }
  }

  return entries;
}

function toObjectId(value) {
  if (value == null) return value;
  if (typeof value === "object") return value;
  return new mongoose.Types.ObjectId(String(value));
}
