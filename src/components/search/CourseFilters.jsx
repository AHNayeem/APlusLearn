"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge, Button, Select } from "@/components/ui";
import { GRADE_STAGES } from "@/constants";

/** Keys the rail owns; the search bar owns the rest. */
const REFINEMENT_KEYS = [
  "stage", "stream", "minGrade", "maxGrade", "hasTutors", "hasCode", "popular",
];

/**
 * Course filters (§13, §14).
 *
 * Same contract as the tutor rail: filters write to the URL rather than to
 * component state, so a filtered browse is shareable, bookmarkable, survives a
 * refresh and stays server-rendered (§29, §43).
 */
export function CourseFilters({ facets, grades = [], subjects = [], className }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [mobileOpen, setMobileOpen] = useState(false);

  const get = (key) => params.get(key) ?? "";
  const getAll = (key) => (params.get(key) ? params.get(key).split(",") : []);

  const update = (changes) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) {
        next.delete(key);
      } else {
        next.set(key, Array.isArray(value) ? value.join(",") : String(value));
      }
    }
    // Any filter change returns to the first page.
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const toggleInList = (key, value) => {
    const current = getAll(key);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    update({ [key]: next });
  };

  const activeCount = REFINEMENT_KEYS.filter((key) => params.get(key)).length;

  const clearAll = () => {
    const next = new URLSearchParams();
    // Keep what is being searched for, drop the refinements.
    for (const key of ["q", "province", "grade", "subject", "sort"]) {
      if (params.get(key)) next.set(key, params.get(key));
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const totals = facets?.totals;

  const panel = (
    <div className="space-y-7">
      <FilterGroup title="School level">
        <div className="space-y-2.5">
          {GRADE_STAGES.map((stage) => (
            <CheckRow
              key={stage.value}
              label={stage.label}
              hint={stage.hint}
              count={facets?.stages?.[stage.value]}
              checked={getAll("stage").includes(stage.value)}
              onChange={() => toggleInList("stage", stage.value)}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Grade" hint="Narrow to a single grade, or a span of them">
        <Select
          value={get("grade")}
          onChange={(e) => update({ grade: e.target.value })}
          aria-label="Grade"
        >
          <option value="">Any grade</option>
          {grades.map((grade) => (
            <option key={grade.id} value={grade.slug}>
              {grade.name}
              {facets?.grades?.[grade.slug] !== undefined ? ` (${facets.grades[grade.slug]})` : ""}
            </option>
          ))}
        </Select>

        <div className="mt-2 flex items-center gap-2">
          <Select
            value={get("minGrade")}
            onChange={(e) => update({ minGrade: e.target.value })}
            aria-label="Lowest grade"
            className="h-10"
          >
            <option value="">From</option>
            {GRADE_LEVELS.map((level) => (
              <option key={level} value={level}>{gradeName(level)}</option>
            ))}
          </Select>
          <span className="text-ink-400">–</span>
          <Select
            value={get("maxGrade")}
            onChange={(e) => update({ maxGrade: e.target.value })}
            aria-label="Highest grade"
            className="h-10"
          >
            <option value="">To</option>
            {GRADE_LEVELS.map((level) => (
              <option key={level} value={level}>{gradeName(level)}</option>
            ))}
          </Select>
        </div>
      </FilterGroup>

      <FilterGroup title="Subject">
        <Select
          value={get("subject")}
          onChange={(e) => update({ subject: e.target.value })}
          aria-label="Subject"
        >
          <option value="">All subjects</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.slug}>
              {subject.name}
              {facets?.subjects?.[subject.slug] !== undefined
                ? ` (${facets.subjects[subject.slug]})`
                : ""}
            </option>
          ))}
        </Select>
      </FilterGroup>

      {facets?.streams?.length > 0 && (
        <FilterGroup title="Stream" hint="University, college, applied, de-streamed…">
          <div className="space-y-2.5">
            {facets.streams.map((stream) => (
              <CheckRow
                key={stream.value}
                label={stream.value}
                count={stream.count}
                checked={getAll("stream").includes(stream.value)}
                onChange={() => toggleInList("stream", stream.value)}
              />
            ))}
          </div>
        </FilterGroup>
      )}

      <FilterGroup title="Availability">
        <div className="space-y-2.5">
          <CheckRow
            label="Has tutors available"
            count={totals?.withTutors}
            checked={get("hasTutors") === "true"}
            onChange={(e) => update({ hasTutors: e.target.checked ? "true" : "" })}
          />
          <CheckRow
            label="Most requested"
            count={totals?.popular}
            checked={get("popular") === "true"}
            onChange={(e) => update({ popular: e.target.checked ? "true" : "" })}
          />
        </div>
      </FilterGroup>

      <FilterGroup title="Course code" hint="Ontario secondary courses carry a code; elementary ones don't">
        <div className="space-y-2">
          {[
            { value: "", label: "Coded and uncoded" },
            { value: "true", label: "Has a course code", count: totals?.withCode },
            {
              value: "false",
              label: "No course code",
              count: totals ? totals.courses - totals.withCode : undefined,
            },
          ].map((option) => (
            <label key={option.value || "any"} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="hasCode"
                checked={get("hasCode") === option.value}
                onChange={() => update({ hasCode: option.value })}
                className="size-4 border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="flex-1 text-sm text-ink-700">{option.label}</span>
              <FacetCount count={option.count} />
            </label>
          ))}
        </div>
      </FilterGroup>
    </div>
  );

  return (
    <>
      {/* Mobile: filters open in a sheet so the results stay full-width (§33) */}
      <div className="lg:hidden">
        <Button
          variant="secondary"
          onClick={() => setMobileOpen(true)}
          iconLeft={<SlidersHorizontal className="size-4" />}
          fullWidth
        >
          Filters
          {activeCount > 0 && (
            <Badge tone="brand" size="sm" className="ml-1">
              {activeCount}
            </Badge>
          )}
        </Button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
            <div className="flex items-center justify-between border-b border-ink-200 p-4">
              <h2 className="text-base font-bold text-ink-900">Filters</h2>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
                className="rounded-lg p-2 text-ink-500 hover:bg-ink-100"
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{panel}</div>
            <div className="flex gap-3 border-t border-ink-200 p-4">
              <Button variant="ghost" onClick={clearAll} className="flex-1">
                Clear all
              </Button>
              <Button onClick={() => setMobileOpen(false)} className="flex-1">
                Show courses
              </Button>
            </div>
          </div>
        )}
      </div>

      <aside className={cn("hidden lg:block", className)} aria-label="Course filters">
        <div className="sticky top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-5">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-900">Filters</h2>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
              >
                <RotateCcw className="size-3" />
                Clear all
              </button>
            )}
          </div>
          {panel}
        </div>
      </aside>
    </>
  );
}

const GRADE_LEVELS = Array.from({ length: 13 }, (_, level) => level);

function gradeName(level) {
  return level === 0 ? "Kindergarten" : `Grade ${level}`;
}

/**
 * A checkbox row with its facet count on the right. The shared `Checkbox`
 * primitive doesn't stretch its label, so the rail uses the same hand-rolled
 * row shape as the tutor filters' radio options.
 */
function CheckRow({ label, hint, count, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="flex-1 text-sm text-ink-700">
        {label}
        {hint && <span className="ml-1.5 text-xs text-ink-400">{hint}</span>}
      </span>
      <FacetCount count={count} />
    </label>
  );
}

function FacetCount({ count }) {
  if (count === undefined) return null;
  return <span className="text-xs tabular-nums text-ink-400">{count}</span>;
}

function FilterGroup({ title, hint, children }) {
  return (
    <fieldset>
      <legend className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-900">
        {title}
      </legend>
      {hint && <p className="-mt-2 mb-3 text-xs text-ink-400">{hint}</p>}
      {children}
    </fieldset>
  );
}
