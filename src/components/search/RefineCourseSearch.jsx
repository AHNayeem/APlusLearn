"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button, Select } from "@/components/ui";

/**
 * The compact search bar on the course browse page — the counterpart to
 * `RefineSearch` on /find-a-tutor. Seeded from the current URL so it always
 * reflects the search actually being displayed.
 */
export function RefineCourseSearch({ provinces = [], grades = [], subjects = [], className }) {
  const router = useRouter();
  const params = useSearchParams();

  const [query, setQuery] = useState(params.get("q") ?? "");
  const [province, setProvince] = useState(params.get("province") ?? "ON");
  const [grade, setGrade] = useState(params.get("grade") ?? "");
  const [subject, setSubject] = useState(params.get("subject") ?? "");

  // Keep the inputs in step when the URL changes from a chip or filter.
  // Adjusted during render so the controls never lag a frame behind the URL.
  const [lastParams, setLastParams] = useState(params);
  if (lastParams !== params) {
    setLastParams(params);
    setQuery(params.get("q") ?? "");
    setProvince(params.get("province") ?? "ON");
    setGrade(params.get("grade") ?? "");
    setSubject(params.get("subject") ?? "");
  }

  const submit = (event) => {
    event.preventDefault();

    // Preserve the refinements the filter rail owns.
    const next = new URLSearchParams();
    for (const key of [
      "stage", "stream", "minGrade", "maxGrade", "hasTutors", "hasCode", "popular", "sort",
    ]) {
      if (params.get(key)) next.set(key, params.get(key));
    }

    if (query.trim()) next.set("q", query.trim());
    if (province) next.set("province", province);
    if (grade) next.set("grade", grade);
    if (subject) next.set("subject", subject);

    router.push(`/courses?${next.toString()}`);
  };

  return (
    <form onSubmit={submit} role="search" aria-label="Search courses" className={className}>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <label htmlFor="course-q" className="sr-only">
            Course name or code
          </label>
          <input
            id="course-q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="MHF4U, Advanced Functions, Grade 9 math…"
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm",
              "shadow-xs ring-1 ring-inset ring-ink-200 placeholder:text-ink-400",
              "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none",
            )}
          />
        </div>

        <label htmlFor="course-province" className="sr-only">Province</label>
        <Select
          id="course-province"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="h-11"
        >
          {provinces.map((p) => (
            <option key={p.code} value={p.code} disabled={!p.isActive}>
              {p.name}
            </option>
          ))}
        </Select>

        <label htmlFor="course-grade" className="sr-only">Grade</label>
        <Select
          id="course-grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="h-11"
        >
          <option value="">Any grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.slug}>{g.name}</option>
          ))}
        </Select>

        <label htmlFor="course-subject" className="sr-only">Subject</label>
        <Select
          id="course-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="h-11"
        >
          <option value="">Any subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.slug}>{s.name}</option>
          ))}
        </Select>

        <Button type="submit" size="md" className="h-11">
          Search
        </Button>
      </div>
    </form>
  );
}
