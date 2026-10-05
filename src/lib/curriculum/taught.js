/**
 * What a tutor profile copies from the curriculum (§6, §7).
 *
 * A profile keeps each taught course's code, name, subject, grade and
 * province next to the course id, plus flattened arrays of the same, so a
 * search filters on indexed fields without a `$lookup`. Those copies are
 * only trustworthy if exactly one piece of code makes them — this one —
 * and if a curriculum edit (a renamed subject, a corrected code) re-runs
 * it for every profile that teaches the course. Both the onboarding and
 * profile-editing paths and the curriculum admin call these.
 */

/** One taught-course entry, from the live course and the tutor's own terms. */
export function taughtCourseFrom(course, entry = {}) {
  return {
    courseId: course._id ?? course.id,
    code: course.code ?? undefined,
    name: course.name,
    subjectId: course.subjectId,
    subjectSlug: course.subjectSlug,
    gradeLevel: course.gradeLevel,
    gradeSlug: course.gradeSlug,
    provinceCode: course.provinceCode,
    hourlyRateCents: entry.hourlyRateCents,
    yearsTeaching: entry.yearsTeaching ?? 0,
  };
}

/** The flattened, indexable arrays derived from a profile's taught courses. */
export function flattenTaughtCourses(courses = []) {
  return {
    courseIds: courses.map((c) => c.courseId),
    courseCodes: courses.map((c) => c.code).filter(Boolean),
    subjectIds: [...new Set(courses.map((c) => String(c.subjectId)).filter((v) => v && v !== "undefined"))],
    subjectSlugs: [...new Set(courses.map((c) => c.subjectSlug).filter(Boolean))],
    gradeLevels: [...new Set(courses.map((c) => c.gradeLevel).filter((v) => v !== undefined && v !== null))],
    provinceCodes: [...new Set(courses.map((c) => c.provinceCode).filter(Boolean))],
  };
}

/**
 * Rebuild a profile's taught courses from the current course documents.
 * Entries whose course no longer exists are dropped; the tutor's own rate
 * and years for each course are kept.
 */
export function rebuildTaughtCourses(entries = [], courseMap) {
  return entries
    .map((entry) => {
      const course = courseMap.get(String(entry.courseId));
      return course ? taughtCourseFrom(course, entry) : null;
    })
    .filter(Boolean);
}
