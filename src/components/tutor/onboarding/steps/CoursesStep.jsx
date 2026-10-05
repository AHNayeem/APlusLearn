"use client";

import { useEffect, useState } from "react";
import { Search, X, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, qs } from "@/lib/api/client";
import {
  Badge, EmptyState, Field, Input, Select, Spinner,
} from "@/components/ui";

/**
 * Step 5 — courses taught (§13, §17).
 *
 * Province → grade → subject → course, every list read from the curriculum
 * endpoints: the provinces are the ones stored as live, the grades are that
 * province's, the subjects are the ones that province (and grade) actually
 * has courses in, and the courses are that combination's. No province is
 * named in this file, so one an administrator switches on is pickable the
 * same day (R6.5, R13.6).
 *
 * The picker starts on the province the applicant gave in the personal step,
 * but they can switch: an online tutor may teach another province's
 * curriculum. Chosen courses from different provinces sit side by side, each
 * with its own rate and years. The server re-checks every id (R13.6).
 */
export function CoursesStep({
  value, onChange, fieldErrors, application, provinces = [], defaultProvince = "", selectedCourses = [],
}) {
  const selected = value.courses ?? [];
  const liveProvinces = provinces.filter((p) => p.isActive);

  const startProvince = () => {
    const firstChosen = selectedCourses.find((c) => c.id === selected[0]?.courseId)?.provinceCode;
    const personal = application?.data?.PERSONAL?.province;
    const isLive = (code) => liveProvinces.some((p) => p.code === code);
    return [firstChosen, personal, defaultProvince].find((code) => code && isLive(code)) ?? "";
  };

  const [province, setProvince] = useState(startProvince);
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [query, setQuery] = useState("");

  // Each list records which request it answers (`forKey`), so "loading" is
  // derived from state rather than set inside an effect, and a slow answer
  // to an earlier choice can never overwrite a newer one.
  const [tree, setTree] = useState({ forKey: null, grades: [], subjects: [] });
  const [gradeSubjects, setGradeSubjects] = useState({ forKey: null, items: [] });
  const [results, setResults] = useState({ forKey: null, items: [] });
  const [details, setDetails] = useState(() =>
    Object.fromEntries(selectedCourses.map((course) => [course.id, course])),
  );

  const treeKey = province;
  const subjectsKey = `${province}|${grade}`;
  const term = query.trim();
  const canSearch = Boolean(province && ((grade && subject) || term.length >= 2));
  const resultsKey = `${province}|${grade}|${subject}|${term}`;

  useEffect(() => {
    if (!province) return;
    api
      .get(`/api/curriculum/tree${qs({ province })}`)
      .then((data) =>
        setTree({ forKey: province, grades: data.grades ?? [], subjects: data.subjects ?? [] }),
      )
      .catch(() => setTree({ forKey: province, grades: [], subjects: [] }));
  }, [province]);

  useEffect(() => {
    if (!province || !grade) return;
    const key = `${province}|${grade}`;
    api
      .get(`/api/curriculum/subjects${qs({ province, grade })}`)
      .then((data) => setGradeSubjects({ forKey: key, items: data.subjects ?? [] }))
      .catch(() => setGradeSubjects({ forKey: key, items: [] }));
  }, [province, grade]);

  useEffect(() => {
    if (!canSearch) return;
    const key = `${province}|${grade}|${subject}|${term}`;
    const params = { province, pageSize: 60, sort: "GRADE_ASC" };
    if (grade) params.grade = grade;
    if (subject) params.subject = subject;
    if (term) params.q = term;

    const timer = window.setTimeout(() => {
      api
        .get(`/api/curriculum/courses${qs(params)}`)
        .then((data) => {
          setResults({ items: data.courses ?? [], forKey: key });
          setDetails((d) => {
            const next = { ...d };
            for (const course of data.courses ?? []) next[course.id] = course;
            return next;
          });
        })
        .catch(() => setResults({ items: [], forKey: key }));
    }, term ? 220 : 0);

    return () => window.clearTimeout(timer);
  }, [canSearch, province, grade, subject, term]);

  const treeLoading = Boolean(province) && tree.forKey !== treeKey;
  const grades = tree.forKey === treeKey ? tree.grades : [];
  const subjects = grade
    ? gradeSubjects.forKey === subjectsKey
      ? gradeSubjects.items
      : []
    : [];
  const subjectsLoading = Boolean(grade) && gradeSubjects.forKey !== subjectsKey;
  const resultsLoading = canSearch && results.forKey !== resultsKey;
  const provinceName = (code) => provinces.find((p) => p.code === code)?.name ?? code;

  const chooseProvince = (code) => {
    setProvince(code);
    setGrade("");
    setSubject("");
  };
  const chooseGrade = (slug) => {
    setGrade(slug);
    setSubject("");
  };

  const toggle = (course) => {
    const exists = selected.find((c) => c.courseId === course.id);
    if (exists) {
      onChange({ ...value, courses: selected.filter((c) => c.courseId !== course.id) });
    } else {
      onChange({
        ...value,
        courses: [...selected, { courseId: course.id, yearsTeaching: 0 }],
      });
      setDetails((d) => ({ ...d, [course.id]: course }));
    }
  };

  const updateCourse = (courseId, patch) =>
    onChange({
      ...value,
      courses: selected.map((c) => (c.courseId === courseId ? { ...c, ...patch } : c)),
    });

  if (liveProvinces.length === 0) {
    return (
      <EmptyState
        compact
        icon={<BookOpen className="size-6" />}
        title="No curriculum is open yet"
        description="Courses can be chosen once a province is live. Save your progress and come back."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-ink-800">
          Selected courses{" "}
          <span className="font-normal text-ink-400">({selected.length})</span>
        </h3>
        {fieldErrors.courses && (
          <p className="mt-1 text-xs font-medium text-danger-600">{fieldErrors.courses}</p>
        )}

        {selected.length === 0 ? (
          <EmptyState
            compact
            className="mt-3"
            icon={<BookOpen className="size-6" />}
            title="No courses selected"
            description="Choose a province, grade and subject below, then pick every course you're confident teaching."
          />
        ) : (
          <ul className="mt-3 space-y-2">
            {selected.map((entry) => {
              const course = details[entry.courseId];
              return (
                <li
                  key={entry.courseId}
                  className="rounded-xl border border-brand-200 bg-brand-50/40 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink-900">
                        {course?.code ? `${course.code} — ` : ""}
                        {course?.name ?? "Course"}
                      </p>
                      {course && (
                        <p className="mt-0.5 text-xs text-ink-500">
                          {provinceName(course.provinceCode)} · Grade {course.gradeLevel}
                          {course.subjectName ? ` · ${course.subjectName}` : ""}
                          {course.stream ? ` · ${course.stream}` : ""}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle({ id: entry.courseId })}
                      aria-label={`Remove ${course?.name ?? "course"}`}
                      className="shrink-0 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Years teaching this" htmlFor={`course-years-${entry.courseId}`}>
                      <Select
                        id={`course-years-${entry.courseId}`}
                        value={entry.yearsTeaching ?? 0}
                        onChange={(e) =>
                          updateCourse(entry.courseId, { yearsTeaching: Number(e.target.value) })
                        }
                        className="h-10"
                      >
                        {Array.from({ length: 31 }, (_, i) => i).map((n) => (
                          <option key={n} value={n}>
                            {n === 0 ? "Less than a year" : `${n} ${n === 1 ? "year" : "years"}`}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field
                      label="Rate for this course"
                      htmlFor={`course-rate-${entry.courseId}`}
                      hint="Leave blank to use your standard rate."
                    >
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                          $
                        </span>
                        <input
                          id={`course-rate-${entry.courseId}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={entry.hourlyRateCents ? entry.hourlyRateCents / 100 : ""}
                          onChange={(e) =>
                            updateCourse(entry.courseId, {
                              hourlyRateCents: e.target.value
                                ? Math.round(Number(e.target.value) * 100)
                                : undefined,
                            })
                          }
                          placeholder="Standard"
                          className="h-10 w-full rounded-xl border-0 bg-white pl-7 pr-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                        />
                      </div>
                    </Field>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-ink-100 pt-5">
        <h3 className="mb-3 text-sm font-semibold text-ink-800">Find courses</h3>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Province" htmlFor="course-province">
            <Select
              id="course-province"
              value={province}
              onChange={(e) => chooseProvince(e.target.value)}
            >
              <option value="" disabled>
                Choose a province
              </option>
              {liveProvinces.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Grade" htmlFor="course-grade">
            <Select
              id="course-grade"
              value={grade}
              onChange={(e) => chooseGrade(e.target.value)}
              disabled={!province || treeLoading}
            >
              <option value="">{treeLoading ? "Loading…" : "Choose a grade"}</option>
              {grades.map((g) => (
                <option key={g.id} value={g.slug}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Subject" htmlFor="course-subject">
            <Select
              id="course-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!grade || subjectsLoading}
            >
              <option value="">
                {!grade ? "Choose a grade first" : subjectsLoading ? "Loading…" : "Choose a subject"}
              </option>
              {subjects.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Input
          className="mt-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Or search ${province ? provinceName(province) : "the"} courses by name or code`}
          iconLeft={<Search className="size-4" />}
          aria-label="Search courses by name or code"
        />

        <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-ink-200">
          {!canSearch ? (
            <p className="px-4 py-10 text-center text-sm text-ink-500">
              Choose a grade and a subject to see its courses.
            </p>
          ) : resultsLoading ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-5 text-ink-400" />
            </div>
          ) : results.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-500">
              No courses match that choice.
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {results.items.map((course) => {
                const isSelected = selected.some((c) => c.courseId === course.id);
                return (
                  <li key={course.id}>
                    <button
                      type="button"
                      onClick={() => toggle(course)}
                      aria-pressed={isSelected}
                      className={cn(
                        "flex w-full items-center gap-3 p-3 text-left transition-colors",
                        isSelected ? "bg-brand-50" : "hover:bg-ink-50",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-black",
                          isSelected ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600",
                        )}
                      >
                        {course.code ?? course.provinceCode}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-900">
                          {course.name}
                        </span>
                        <span className="block text-xs text-ink-500">
                          Grade {course.gradeLevel} · {course.subjectName}
                          {course.stream ? ` · ${course.stream}` : ""}
                        </span>
                      </span>
                      {isSelected && <Badge tone="brand" size="sm">Added</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
