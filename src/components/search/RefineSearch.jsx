"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, MapPin } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button, Select } from "@/components/ui";
import { qs } from "@/lib/api/client";

/**
 * The compact search bar on the results page. Seeded from the current URL so
 * it always reflects the search actually being displayed.
 */
export function RefineSearch({ provinces = [], grades = [], subjects = [], className }) {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = useState(params.get("courseCode") ?? params.get("q") ?? "");
  const [province, setProvince] = useState(params.get("province") ?? "ON");
  const [grade, setGrade] = useState(params.get("grade") ?? "");
  const [subject, setSubject] = useState(params.get("subject") ?? "");
  const [location, setLocation] = useState(params.get("city") ?? params.get("postalCode") ?? "");

  // Keep the inputs in step when the URL changes from a chip or filter.
  // Adjusted during render so the controls never lag a frame behind the URL.
  const [lastParams, setLastParams] = useState(params);
  if (lastParams !== params) {
    setLastParams(params);
    setQuery(params.get("courseCode") ?? params.get("q") ?? "");
    setProvince(params.get("province") ?? "ON");
    setGrade(params.get("grade") ?? "");
    setSubject(params.get("subject") ?? "");
    setLocation(params.get("city") ?? params.get("postalCode") ?? "");
  }

  const submit = (event) => {
    event.preventDefault();

    // Preserve the refinements the filter rail owns.
    const next = new URLSearchParams();
    for (const key of [
      "mode", "minPrice", "maxPrice", "minRating", "minExperience",
      "qualifications", "verified", "availability", "distanceKm", "freeIntro", "sort",
    ]) {
      if (params.get(key)) next.set(key, params.get(key));
    }

    const trimmed = query.trim();
    if (/^[A-Za-z]{3}[A-Za-z0-9]{1,5}$/.test(trimmed)) next.set("courseCode", trimmed.toUpperCase());
    else if (trimmed) next.set("q", trimmed);

    if (province) next.set("province", province);
    if (grade) next.set("grade", grade);
    if (subject) next.set("subject", subject);

    if (location.trim()) {
      const isPostal = /^[A-Za-z]\d[A-Za-z]/.test(location.trim());
      next.set(isPostal ? "postalCode" : "city", location.trim());
    }

    router.push(`/find-a-tutor?${next.toString()}`);
  };

  return (
    <form onSubmit={submit} role="search" aria-label="Refine search" className={className}>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.2fr)_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <label htmlFor="refine-q" className="sr-only">
            Course, code or keyword
          </label>
          <input
            id="refine-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Course or code"
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm",
              "shadow-xs ring-1 ring-inset ring-ink-200 placeholder:text-ink-400",
              "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none",
            )}
          />
        </div>

        <label htmlFor="refine-province" className="sr-only">Province</label>
        <Select id="refine-province" value={province} onChange={(e) => setProvince(e.target.value)} className="h-11">
          {provinces.map((p) => (
            <option key={p.code} value={p.code} disabled={!p.isActive}>
              {p.name}
            </option>
          ))}
        </Select>

        <label htmlFor="refine-grade" className="sr-only">Grade</label>
        <Select id="refine-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className="h-11">
          <option value="">Any grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.slug}>{g.name}</option>
          ))}
        </Select>

        <label htmlFor="refine-subject" className="sr-only">Subject</label>
        <Select id="refine-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-11">
          <option value="">Any subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.slug}>{s.name}</option>
          ))}
        </Select>

        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <label htmlFor="refine-location" className="sr-only">City or postal code</label>
          <input
            id="refine-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or postal code"
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm",
              "shadow-xs ring-1 ring-inset ring-ink-200 placeholder:text-ink-400",
              "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none",
            )}
          />
        </div>

        <Button type="submit" size="md" className="h-11">
          Search
        </Button>
      </div>
    </form>
  );
}
