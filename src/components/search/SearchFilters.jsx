"use client";

import { useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal, X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge, Button, Checkbox, Select } from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";
import {
  LESSON_MODES, LESSON_MODE_LABELS, VERIFICATION_TYPES, VERIFICATION_LABELS,
  QUALIFICATION_TYPES, QUALIFICATION_LABELS, AVAILABILITY_WINDOWS,
  DISTANCE_OPTIONS, PRICE_RANGE, RATING_OPTIONS, EXPERIENCE_OPTIONS,
} from "@/constants";

/**
 * Search filters (§14).
 *
 * Filters write to the URL rather than to component state, so a filtered
 * search is shareable, bookmarkable and survives a refresh — and the results
 * stay server-rendered (§29, §43).
 */
export function SearchFilters({ facets, resolved, className }) {
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

  const activeCount = [
    "mode", "minPrice", "maxPrice", "minRating", "minExperience",
    "qualifications", "verified", "availability", "distanceKm", "freeIntro",
  ].filter((key) => params.get(key)).length;

  const clearAll = () => {
    const next = new URLSearchParams();
    // Keep the search subject, drop the refinements.
    for (const key of ["q", "province", "grade", "subject", "course", "courseCode", "city", "postalCode"]) {
      if (params.get(key)) next.set(key, params.get(key));
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const panel = (
    <div className="space-y-7">
      <FilterGroup title="Lesson type">
        <div className="space-y-2">
          {[
            { value: "", label: "Online or in person" },
            ...Object.values(LESSON_MODES).map((m) => ({
              value: m,
              label: LESSON_MODE_LABELS[m],
              count: facets?.modes?.[m],
            })),
          ].map((option) => (
            <label key={option.value || "any"} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="mode"
                checked={get("mode") === option.value}
                onChange={() => update({ mode: option.value })}
                className="size-4 border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="flex-1 text-sm text-ink-700">{option.label}</span>
              {option.count !== undefined && (
                <span className="text-xs text-ink-400">{option.count}</span>
              )}
            </label>
          ))}
        </div>
      </FilterGroup>

      {get("mode") !== LESSON_MODES.ONLINE && (
        <FilterGroup title="Distance" hint="From the city or postal code you searched">
          <Select
            value={get("distanceKm")}
            onChange={(e) => update({ distanceKm: e.target.value })}
            aria-label="Maximum distance"
          >
            <option value="">Any distance</option>
            {DISTANCE_OPTIONS.map((km) => (
              <option key={km} value={km}>
                Within {km} km
              </option>
            ))}
          </Select>
        </FilterGroup>
      )}

      <FilterGroup
        title="Hourly rate"
        hint={
          facets?.price
            ? `Tutors here charge ${formatMoney(facets.price.minCents, { compact: true })}–${formatMoney(facets.price.maxCents, { compact: true })}`
            : undefined
        }
      >
        <PriceFilter
          min={Number(get("minPrice")) || undefined}
          max={Number(get("maxPrice")) || undefined}
          onChange={(minPrice, maxPrice) => update({ minPrice, maxPrice })}
        />
      </FilterGroup>

      <FilterGroup title="Rating">
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="minRating"
              checked={!get("minRating")}
              onChange={() => update({ minRating: "" })}
              className="size-4 border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-ink-700">Any rating</span>
          </label>
          {RATING_OPTIONS.map((rating) => (
            <label key={rating} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="minRating"
                checked={get("minRating") === String(rating)}
                onChange={() => update({ minRating: rating })}
                className="size-4 border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-ink-700">{rating}+ stars</span>
            </label>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Verification">
        <div className="space-y-2.5">
          {Object.values(VERIFICATION_TYPES).map((type) => (
            <Checkbox
              key={type}
              label={VERIFICATION_LABELS[type]}
              checked={getAll("verified").includes(type)}
              onChange={() => toggleInList("verified", type)}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Qualifications">
        <div className="space-y-2.5">
          {Object.values(QUALIFICATION_TYPES).map((type) => (
            <Checkbox
              key={type}
              label={QUALIFICATION_LABELS[type]}
              checked={getAll("qualifications").includes(type)}
              onChange={() => toggleInList("qualifications", type)}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Availability">
        <div className="space-y-2.5">
          {AVAILABILITY_WINDOWS.map((window) => (
            <Checkbox
              key={window.value}
              label={window.label}
              checked={getAll("availability").includes(window.value)}
              onChange={() => toggleInList("availability", window.value)}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Experience">
        <Select
          value={get("minExperience")}
          onChange={(e) => update({ minExperience: e.target.value })}
          aria-label="Minimum experience"
        >
          <option value="">Any experience</option>
          {EXPERIENCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FilterGroup>

      <FilterGroup title="Other">
        <Checkbox
          label="Offers a free intro session"
          checked={get("freeIntro") === "true"}
          onChange={(e) => update({ freeIntro: e.target.checked ? "true" : "" })}
        />
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
                Show results
              </Button>
            </div>
          </div>
        )}
      </div>

      <aside className={cn("hidden lg:block", className)} aria-label="Search filters">
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

/** Two bounded number inputs — clearer than a dual slider on touch. */
function PriceFilter({ min, max, onChange }) {
  const [localMin, setLocalMin] = useState(min ? min / 100 : "");
  const [localMax, setLocalMax] = useState(max ? max / 100 : "");

  const commit = () => {
    const minCents = localMin ? Math.round(Number(localMin) * 100) : "";
    const maxCents = localMax ? Math.round(Number(localMax) * 100) : "";
    onChange(minCents, maxCents);
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
            $
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={PRICE_RANGE.min}
            max={PRICE_RANGE.max}
            value={localMin}
            onChange={(e) => setLocalMin(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            placeholder="Min"
            aria-label="Minimum hourly rate"
            className="h-10 w-full rounded-xl border-0 bg-white pl-7 pr-2 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>
        <span className="text-ink-400">–</span>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
            $
          </span>
          <input
            type="number"
            inputMode="numeric"
            min={PRICE_RANGE.min}
            max={PRICE_RANGE.max}
            value={localMax}
            onChange={(e) => setLocalMax(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            placeholder="Max"
            aria-label="Maximum hourly rate"
            className="h-10 w-full rounded-xl border-0 bg-white pl-7 pr-2 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>
      </div>
      <p className="mt-2 text-xs text-ink-400">Per hour, in Canadian dollars</p>
    </div>
  );
}
