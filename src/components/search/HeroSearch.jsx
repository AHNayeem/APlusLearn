"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, MapPin, Loader2, GraduationCap, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, qs } from "@/lib/api/client";
import { Button, Select } from "@/components/ui";
import { LESSON_MODES } from "@/constants";

/**
 * The homepage hero search (§12).
 *
 * Searching does not require an account: this builds a URL and navigates to
 * /find-a-tutor, which is a public, server-rendered page.
 */
export function HeroSearch({ provinces = [], grades = [], subjects = [], className }) {
  const router = useRouter();
  const [province, setProvince] = useState(provinces.find((p) => p.isActive)?.code ?? "ON");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState("ANY");
  const [location, setLocation] = useState("");
  const [query, setQuery] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const params = { province, grade, subject, mode: mode === "ANY" ? "" : mode };

    // A bare course code is the fastest path — send it as such.
    const trimmed = query.trim();
    if (/^[A-Za-z]{3}[A-Za-z0-9]{1,5}$/.test(trimmed)) params.courseCode = trimmed.toUpperCase();
    else if (trimmed) params.q = trimmed;

    if (location.trim()) {
      const isPostal = /^[A-Za-z]\d[A-Za-z]/.test(location.trim());
      params[isPostal ? "postalCode" : "city"] = location.trim();
    }

    router.push(`/find-a-tutor${qs(params)}`);
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "rounded-2xl border border-ink-200/80 bg-white/95 p-3 shadow-xl backdrop-blur-sm sm:p-4",
        className,
      )}
      role="search"
      aria-label="Find a tutor"
    >
      <CourseAutocomplete
        value={query}
        onChange={setQuery}
        province={province}
        onPick={(item) => router.push(item.href)}
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="sr-only" htmlFor="hero-province">Province</label>
        <Select
          id="hero-province"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          className="h-11"
        >
          {provinces.map((p) => (
            <option key={p.code} value={p.code} disabled={!p.isActive}>
              {p.name}
              {p.isActive ? "" : " — coming soon"}
            </option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="hero-grade">Grade</label>
        <Select
          id="hero-grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          className="h-11"
        >
          <option value="">Any grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.slug}>
              {g.name}
            </option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="hero-subject">Subject</label>
        <Select
          id="hero-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="h-11"
        >
          <option value="">Any subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name}
            </option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="hero-mode">Lesson type</label>
        <Select
          id="hero-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="h-11"
        >
          <option value="ANY">Online or in person</option>
          <option value={LESSON_MODES.ONLINE}>Online only</option>
          <option value={LESSON_MODES.IN_PERSON}>In person only</option>
        </Select>
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
          <label className="sr-only" htmlFor="hero-location">City or postal code</label>
          <input
            id="hero-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City or postal code (for in-person lessons)"
            autoComplete="postal-code"
            className={cn(
              "h-11 w-full rounded-xl border-0 bg-white pl-10 pr-3 text-sm text-ink-800",
              "shadow-xs ring-1 ring-inset ring-ink-200 placeholder:text-ink-400",
              "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none",
            )}
          />
        </div>
        <Button type="submit" size="lg" className="h-11 sm:px-8" iconLeft={<Search className="size-4" />}>
          Search tutors
        </Button>
      </div>

      <p className="mt-3 px-1 text-xs text-ink-500">
        No account needed to search. Try a course code like{" "}
        <button
          type="button"
          onClick={() => setQuery("MHF4U")}
          className="font-semibold text-brand-600 hover:underline"
        >
          MHF4U
        </button>{" "}
        or a subject name.
      </p>
    </form>
  );
}

/**
 * Course/subject autocomplete. Debounced, keyboard-navigable, and backed by
 * /api/search/suggest so it matches on course name *and* provincial code (§13).
 */
function CourseAutocomplete({ value, onChange, province, onPick }) {
  // `forKey` records which query these suggestions belong to, which makes both
  // "loading" and "too short to search" derived rather than effect-driven.
  const [suggestions, setSuggestions] = useState({ items: [], forKey: "" });
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef(null);
  const abortRef = useRef(null);

  const term = value.trim();
  const searchKey = term.length < 2 ? "" : `${term}|${province ?? ""}`;
  const loading = Boolean(searchKey) && suggestions.forKey !== searchKey;
  const results = suggestions.forKey === searchKey ? suggestions.items : [];
  const open = !dismissed && results.length > 0;

  useEffect(() => {
    if (!searchKey) return undefined;

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const data = await api.get(`/api/search/suggest${qs({ q: term, province, limit: 8 })}`, {
          signal: controller.signal,
        });
        const merged = [...(data.courses ?? []), ...(data.subjects ?? [])];
        setSuggestions({ items: merged, forKey: searchKey });
        setDismissed(false);
        setHighlighted(-1);
      } catch {
        // A failed suggestion is not worth interrupting the user for — they
        // can still submit the form with free text.
        setSuggestions({ items: [], forKey: searchKey });
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [searchKey, term, province]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setDismissed(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const onKeyDown = (event) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, -1));
    } else if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      onPick(results[highlighted]);
      setDismissed(true);
    } else if (event.key === "Escape") {
      setDismissed(true);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-400" />
      <label className="sr-only" htmlFor="hero-course">Course, course code or subject</label>
      <input
        id="hero-course"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDismissed(false);
        }}
        onFocus={() => setDismissed(false)}
        onKeyDown={onKeyDown}
        placeholder="Course name or code — e.g. Advanced Functions or MHF4U"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="hero-course-results"
        aria-autocomplete="list"
        aria-activedescendant={highlighted >= 0 ? `hero-course-${highlighted}` : undefined}
        className={cn(
          "h-14 w-full rounded-xl border-0 bg-white pl-12 pr-11 text-base font-medium text-ink-900",
          "shadow-xs ring-1 ring-inset ring-ink-200 placeholder:font-normal placeholder:text-ink-400",
          "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none",
        )}
      />
      {loading && (
        <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-400" />
      )}

      {open && (
        <ul
          id="hero-course-results"
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-ink-200 bg-white p-1.5 shadow-xl"
        >
          {results.map((item, index) => (
            <li key={`${item.type}-${item.id}`}>
              <button
                type="button"
                id={`hero-course-${index}`}
                role="option"
                aria-selected={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => {
                  onPick(item);
                  setDismissed(true);
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  index === highlighted ? "bg-brand-50" : "hover:bg-ink-50",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    item.type === "COURSE" ? "bg-brand-100 text-brand-600" : "bg-accent-100 text-accent-700",
                  )}
                >
                  {item.type === "COURSE" ? (
                    <BookOpen className="size-4" />
                  ) : (
                    <GraduationCap className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-900">
                    {item.label}
                  </span>
                  <span className="block truncate text-xs text-ink-500">{item.sublabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
