"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, MapPin } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button, Select } from "@/components/ui";
import { useProvinceCurriculum } from "@/hooks/useProvinceCurriculum";
import { FILTER_KEYS } from "./SearchFilters";

/**
 * The compact search bar on the results page. Seeded from the current URL so
 * it always reflects the search actually being displayed.
 *
 * Grades and subjects follow the province chosen here (R2.3), the typed
 * words go to the server as `q` to be matched against the curriculum
 * (R2.5), and a refine keeps everything the visitor already chose — the
 * course they arrived with and every filter in the rail (R7.4).
 */
export function RefineSearch({ provinces = [], grades = [], subjects = [], province: currentProvince, className }) {
  const router = useRouter();
  const params = useSearchParams();
  const curriculum = useProvinceCurriculum({ province: currentProvince, grades, subjects });

  const queryFromUrl = () => params.get("q") ?? params.get("courseCode") ?? "";
  const [query, setQuery] = useState(queryFromUrl);
  const [grade, setGrade] = useState(params.get("grade") ?? "");
  const [subject, setSubject] = useState(params.get("subject") ?? "");
  const [location, setLocation] = useState(params.get("city") ?? params.get("postalCode") ?? "");

  // Keep the inputs in step when the URL changes from a chip or filter.
  // Adjusted during render so the controls never lag a frame behind the URL.
  const [lastParams, setLastParams] = useState(params);
  if (lastParams !== params) {
    setLastParams(params);
    setQuery(queryFromUrl());
    setGrade(params.get("grade") ?? "");
    setSubject(params.get("subject") ?? "");
    setLocation(params.get("city") ?? params.get("postalCode") ?? "");
  }

  const changeProvince = async (code) => {
    const tree = await curriculum.setProvince(code);
    // A grade or subject the new province does not have would silently
    // match nothing; drop it instead.
    if (tree && !tree.grades?.some((g) => g.slug === grade)) setGrade("");
    if (tree && !tree.subjects?.some((s) => s.slug === subject)) setSubject("");
  };

  const submit = (event) => {
    event.preventDefault();

    // Preserve the refinements the filter rail owns.
    const next = new URLSearchParams();
    for (const key of [...FILTER_KEYS, "sort"]) {
      if (params.get(key)) next.set(key, params.get(key));
    }

    const province = curriculum.province;
    const sameProvince = province === (params.get("province") ?? currentProvince);
    const trimmed = query.trim();
    if (trimmed && trimmed === params.get("courseCode") && sameProvince) {
      next.set("courseCode", params.get("courseCode"));
    } else if (trimmed) {
      next.set("q", trimmed);
    }
    // The course they arrived with stays, unless the province changed under it.
    if (params.get("course") && sameProvince) next.set("course", params.get("course"));

    if (province) next.set("province", province);
    if (grade) next.set("grade", grade);
    if (subject) next.set("subject", subject);

    if (location.trim()) {
      // A Canadian postal code starts letter-digit-letter; anything else is a place name.
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
            placeholder="Subject, course or code"
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm",
              "shadow-xs ring-1 ring-inset ring-ink-200 placeholder:text-ink-400",
              "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none",
            )}
          />
        </div>

        <label htmlFor="refine-province" className="sr-only">Province</label>
        <Select id="refine-province" value={curriculum.province} onChange={(e) => changeProvince(e.target.value)} className="h-11">
          {provinces.map((p) => (
            <option key={p.code} value={p.code} disabled={!p.isActive}>
              {p.name}
              {p.isActive ? "" : " — coming soon"}
            </option>
          ))}
        </Select>

        <label htmlFor="refine-grade" className="sr-only">Grade</label>
        <Select id="refine-grade" value={grade} onChange={(e) => setGrade(e.target.value)} className="h-11">
          <option value="">Any grade</option>
          {curriculum.grades.map((g) => (
            <option key={g.id} value={g.slug}>{g.name}</option>
          ))}
        </Select>

        <label htmlFor="refine-subject" className="sr-only">Subject</label>
        <Select id="refine-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="h-11">
          <option value="">Any subject</option>
          {curriculum.subjects.map((s) => (
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
