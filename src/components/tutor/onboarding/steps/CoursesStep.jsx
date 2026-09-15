"use client";

import { useEffect, useState } from "react";
import { Search, X, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, qs } from "@/lib/api/client";
import {
  Badge, Button, EmptyState, Field, Input, Select, Spinner,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/**
 * Step 5 — courses taught (§17).
 *
 * Courses are picked from the real provincial curriculum rather than typed
 * free-text, which is what lets search match on course code (§13).
 */
export function CoursesStep({ value, onChange, fieldErrors, grades = [] }) {
  const selected = value.courses ?? [];

  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  // `forKey` records which query the results belong to, so "loading" is
  // derived from state rather than set inside the effect.
  const [results, setResults] = useState({ items: [], forKey: null });
  const [details, setDetails] = useState({});

  const searchKey = `${query.trim()}|${gradeFilter}`;
  const loading = results.forKey !== searchKey;

  // Search the catalogue as the tutor types.
  useEffect(() => {
    const params = { province: "ON", pageSize: 40 };
    if (query.trim()) params.q = query.trim();
    if (gradeFilter) params.grade = gradeFilter;
    if (!query.trim() && !gradeFilter) params.popular = "true";

    const timer = window.setTimeout(() => {
      api
        .get(`/api/curriculum/courses${qs(params)}`)
        .then((data) => {
          setResults({ items: data.courses ?? [], forKey: searchKey });
          setDetails((d) => {
            const next = { ...d };
            for (const course of data.courses ?? []) next[course.id] = course;
            return next;
          });
        })
        .catch(() => setResults({ items: [], forKey: searchKey }));
    }, 220);

    return () => window.clearTimeout(timer);
  }, [query, gradeFilter, searchKey]);

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
            description="Search below and pick every course you're confident teaching."
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
                          Grade {course.gradeLevel} · {course.stream}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle({ id: entry.courseId })}
                      aria-label="Remove course"
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
                          min={15}
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

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or code — MHF4U, Advanced Functions…"
            iconLeft={<Search className="size-4" />}
            aria-label="Search courses"
          />
          <Select
            value={gradeFilter}
            onChange={(e) => setGradeFilter(e.target.value)}
            aria-label="Filter by grade"
          >
            <option value="">All grades</option>
            {grades.map((grade) => (
              <option key={grade.id} value={grade.slug}>
                {grade.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-ink-200">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="size-5 text-ink-400" />
            </div>
          ) : results.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-500">
              No courses match that search.
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
                        {course.code ?? "ON"}
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
