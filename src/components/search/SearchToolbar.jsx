"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Select } from "@/components/ui";
import { SORT_OPTIONS } from "@/lib/search/tutor-query";
import {
  LESSON_MODE_LABELS, VERIFICATION_LABELS, QUALIFICATION_LABELS, AVAILABILITY_WINDOWS,
} from "@/constants";
import { formatMoney } from "@/lib/utils/format";

/**
 * Result count, sort control, and removable chips for every active filter, so
 * it is always obvious why a result set is the size it is (§14, §32).
 */
export function SearchToolbar({ total, resolved }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const setParam = (key, value) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const removeFromList = (key, value) => {
    const current = params.get(key)?.split(",") ?? [];
    const next = current.filter((v) => v !== value);
    setParam(key, next.join(","));
  };

  const chips = buildChips(params, resolved, { setParam, removeFromList });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600" aria-live="polite">
          <span className="font-bold text-ink-900">{total}</span>{" "}
          {total === 1 ? "tutor" : "tutors"}
          {resolved?.course && (
            <>
              {" "}for{" "}
              <span className="font-semibold text-ink-900">
                {resolved.course.code ?? resolved.course.name}
              </span>
            </>
          )}
        </p>

        <div className="flex items-center gap-2">
          <label htmlFor="sort" className="shrink-0 text-sm text-ink-500">
            Sort by
          </label>
          <Select
            id="sort"
            value={params.get("sort") ?? "RELEVANCE"}
            onChange={(e) => setParam("sort", e.target.value)}
            className="h-9 w-auto min-w-44 py-0 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
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

function buildChips(params, resolved, { setParam, removeFromList }) {
  const chips = [];
  const add = (key, label, onRemove) => chips.push({ key, label, onRemove });

  if (params.get("q")) add("q", `“${params.get("q")}”`, () => setParam("q", ""));
  if (resolved?.course) {
    add("course", resolved.course.code ?? resolved.course.name, () => {
      setParam("course", "");
      setParam("courseCode", "");
    });
  }
  if (resolved?.subject && !resolved?.course) {
    add("subject", resolved.subject.name, () => setParam("subject", ""));
  }
  if (resolved?.grade) add("grade", resolved.grade.name, () => setParam("grade", ""));
  if (params.get("mode")) {
    add("mode", LESSON_MODE_LABELS[params.get("mode")], () => setParam("mode", ""));
  }
  if (params.get("city")) add("city", params.get("city"), () => setParam("city", ""));
  if (params.get("postalCode")) {
    add("postalCode", params.get("postalCode"), () => setParam("postalCode", ""));
  }
  if (params.get("distanceKm")) {
    add("distanceKm", `Within ${params.get("distanceKm")} km`, () => setParam("distanceKm", ""));
  }
  if (params.get("minPrice") || params.get("maxPrice")) {
    const min = params.get("minPrice");
    const max = params.get("maxPrice");
    const label = min && max
      ? `${formatMoney(min, { compact: true })}–${formatMoney(max, { compact: true })}/hr`
      : min
        ? `From ${formatMoney(min, { compact: true })}/hr`
        : `Up to ${formatMoney(max, { compact: true })}/hr`;
    add("price", label, () => {
      setParam("minPrice", "");
      setParam("maxPrice", "");
    });
  }
  if (params.get("minRating")) {
    add("minRating", `${params.get("minRating")}+ stars`, () => setParam("minRating", ""));
  }
  if (params.get("minExperience")) {
    add("minExperience", `${params.get("minExperience")}+ years`, () => setParam("minExperience", ""));
  }
  if (params.get("freeIntro")) add("freeIntro", "Free intro", () => setParam("freeIntro", ""));

  for (const type of params.get("verified")?.split(",").filter(Boolean) ?? []) {
    add(`verified-${type}`, VERIFICATION_LABELS[type], () => removeFromList("verified", type));
  }
  for (const type of params.get("qualifications")?.split(",").filter(Boolean) ?? []) {
    add(`qual-${type}`, QUALIFICATION_LABELS[type], () => removeFromList("qualifications", type));
  }
  for (const value of params.get("availability")?.split(",").filter(Boolean) ?? []) {
    const window = AVAILABILITY_WINDOWS.find((w) => w.value === value);
    add(`avail-${value}`, window?.label ?? value, () => removeFromList("availability", value));
  }

  return chips;
}
