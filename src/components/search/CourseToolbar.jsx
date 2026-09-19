"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Select } from "@/components/ui";
import { COURSE_SORT_OPTIONS, GRADE_STAGE_LABELS } from "@/constants";

/**
 * Result count, sort control and a removable chip per active filter, so it is
 * always obvious why a result set is the size it is (§14, §32). Mirrors the
 * tutor search toolbar.
 */
export function CourseToolbar({ total, resolved }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Takes every change at once: two sequential single-key pushes would each
  // build from the same stale `params` and the first removal would be lost.
  const setParams = (changes) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const setParam = (key, value) => setParams({ [key]: value });

  const removeFromList = (key, value) => {
    const current = params.get(key)?.split(",") ?? [];
    setParam(key, current.filter((v) => v !== value).join(","));
  };

  const chips = buildChips(params, resolved, { setParam, setParams, removeFromList });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600" aria-live="polite">
          <span className="font-bold text-ink-900">{total}</span>{" "}
          {total === 1 ? "course" : "courses"}
          {resolved?.subject && (
            <>
              {" "}in{" "}
              <span className="font-semibold text-ink-900">{resolved.subject.name}</span>
            </>
          )}
          {params.get("q") && (
            <>
              {" "}matching{" "}
              <span className="font-semibold text-ink-900">“{params.get("q")}”</span>
            </>
          )}
        </p>

        <div className="flex items-center gap-2">
          <label htmlFor="course-sort" className="shrink-0 text-sm text-ink-500">
            Sort by
          </label>
          <Select
            id="course-sort"
            value={params.get("sort") ?? "RELEVANCE"}
            onChange={(e) => setParam("sort", e.target.value)}
            className="h-9 w-auto min-w-44 py-0 text-sm"
          >
            {COURSE_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={chip.onRemove}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 py-1.5 pl-3 pr-2 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition-colors hover:bg-brand-100"
              >
                {chip.label}
                <X className="size-3" aria-hidden="true" />
                <span className="sr-only">Remove filter</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function buildChips(params, resolved, { setParam, setParams, removeFromList }) {
  const chips = [];
  const add = (key, label, onRemove) => chips.push({ key, label, onRemove });

  if (params.get("q")) add("q", `“${params.get("q")}”`, () => setParam("q", ""));
  if (resolved?.grade) add("grade", resolved.grade.name, () => setParam("grade", ""));
  if (resolved?.subject) add("subject", resolved.subject.name, () => setParam("subject", ""));

  for (const stage of params.get("stage")?.split(",").filter(Boolean) ?? []) {
    add(`stage-${stage}`, GRADE_STAGE_LABELS[stage] ?? stage, () => removeFromList("stage", stage));
  }
  for (const stream of params.get("stream")?.split(",").filter(Boolean) ?? []) {
    add(`stream-${stream}`, stream, () => removeFromList("stream", stream));
  }

  const min = params.get("minGrade");
  const max = params.get("maxGrade");
  if (min || max) {
    const label = min && max
      ? `${gradeName(min)}–${gradeName(max)}`
      : min
        ? `${gradeName(min)} and up`
        : `Up to ${gradeName(max)}`;
    add("gradeRange", label, () => setParams({ minGrade: "", maxGrade: "" }));
  }

  if (params.get("hasTutors")) {
    add("hasTutors", "Has tutors", () => setParam("hasTutors", ""));
  }
  if (params.get("popular")) {
    add("popular", "Most requested", () => setParam("popular", ""));
  }
  if (params.get("hasCode")) {
    add(
      "hasCode",
      params.get("hasCode") === "true" ? "Has a course code" : "No course code",
      () => setParam("hasCode", ""),
    );
  }

  return chips;
}

function gradeName(level) {
  return Number(level) === 0 ? "Kindergarten" : `Grade ${level}`;
}
