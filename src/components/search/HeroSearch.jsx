"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search, MapPin, Loader2, GraduationCap, BookOpen, Map, Layers, Video, ChevronDown,
  ArrowRight, CornerDownLeft,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, qs } from "@/lib/api/client";
import { LESSON_MODES } from "@/constants";

/**
 * The homepage hero search (§12).
 *
 * Searching does not require an account: this builds a URL and navigates to
 * /find-a-tutor, which is a public, server-rendered page.
 *
 * Presented as one console rather than six controls — a glass panel holding a
 * query line, a hairline-divided row of refinements, and the submit. The
 * refinements deliberately show their label *and* their current value at rest,
 * because on a hero the visitor needs to see what the search is already
 * scoped to before they decide whether to change it.
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
        "relative rounded-3xl border border-white/10 bg-white/[0.06] p-2.5 sm:p-3",
        "backdrop-blur-2xl",
        // Two shadows doing different jobs: the inset hairline is the glass
        // edge catching light, the cast shadow lifts the console off the grid.
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12),0_40px_90px_-30px_rgb(2_6_23/0.95)]",
        className,
      )}
      role="search"
      aria-label="Find a tutor"
    >
      {/* A faint bloom bleeding out from under the panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-8 -bottom-8 -z-10 h-24 rounded-full bg-brand-500/25 blur-3xl"
      />

      <CourseAutocomplete
        value={query}
        onChange={setQuery}
        province={province}
        onPick={(item) => router.push(item.href)}
      />

      {/* gap-px over a light background paints the hairlines between cells, so
          the four refinements read as one instrument. */}
      <div className="mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 lg:grid-cols-4">
        <ConsoleSelect
          icon={Map}
          label="Province"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
        >
          {provinces.map((p) => (
            <option key={p.code} value={p.code} disabled={!p.isActive}>
              {p.name}
              {p.isActive ? "" : " — coming soon"}
            </option>
          ))}
        </ConsoleSelect>

        <ConsoleSelect
          icon={GraduationCap}
          label="Grade"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
        >
          <option value="">Any grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.slug}>
              {g.name}
            </option>
          ))}
        </ConsoleSelect>

        <ConsoleSelect
          icon={Layers}
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        >
          <option value="">Any subject</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.slug}>
              {s.name}
            </option>
          ))}
        </ConsoleSelect>

        <ConsoleSelect
          icon={Video}
          label="Lesson type"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="ANY">Online or in person</option>
          <option value={LESSON_MODES.ONLINE}>Online only</option>
          <option value={LESSON_MODES.IN_PERSON}>In person only</option>
        </ConsoleSelect>
      </div>

      <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
        <ConsoleInput
          icon={MapPin}
          label="Where"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City or postal code"
          autoComplete="postal-code"
        />
        <SubmitButton />
      </div>

      <p className="mt-3 px-1.5 pb-0.5 text-center text-xs text-white/45 sm:text-left">
        No account needed to search. Try a course code like{" "}
        <button
          type="button"
          onClick={() => setQuery("MHF4U")}
          className="font-semibold text-brand-200 underline-offset-2 transition-colors hover:text-white hover:underline"
        >
          MHF4U
        </button>{" "}
        or a subject name.
      </p>
    </form>
  );
}

/** The accent in the whole hero — one gradient, on the one thing to press. */
function SubmitButton() {
  return (
    <button
      type="submit"
      className={cn(
        "group relative inline-flex h-[3.75rem] w-full shrink-0 items-center justify-center gap-2.5 sm:w-auto",
        "overflow-hidden rounded-2xl px-7 text-[15px] font-bold text-white",
        "bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700",
        "shadow-[0_14px_34px_-12px_rgb(51_102_242/0.9),inset_0_1px_0_0_rgb(255_255_255/0.25)]",
        "transition-[transform,box-shadow] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:shadow-[0_20px_44px_-12px_rgb(51_102_242/1),inset_0_1px_0_0_rgb(255_255_255/0.3)]",
        "active:translate-y-0 active:scale-[0.99]",
        "motion-reduce:hover:translate-y-0",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-400",
      )}
    >
      {/* Highlight sweep on hover, clipped by the button's own radius. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12",
          "bg-gradient-to-r from-transparent via-white/25 to-transparent",
          "transition-transform duration-700 ease-out group-hover:translate-x-[400%]",
        )}
      />
      <Search className="size-[1.1rem]" aria-hidden="true" />
      Search tutors
      <ArrowRight
        className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-1 motion-reduce:group-hover:translate-x-0"
        aria-hidden="true"
      />
    </button>
  );
}

/** One cell of the refinement row: icon, standing label, live value. */
function ConsoleSelect({ icon: Icon, label, children, ...props }) {
  const id = useId();

  return (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 bg-night-soft/85 px-3 py-2.5 sm:gap-3 sm:px-4",
        "transition-colors duration-200 hover:bg-white/[0.07]",
        "focus-within:bg-white/[0.09]",
      )}
    >
      <Icon className="hidden size-4 shrink-0 text-brand-300 min-[420px]:block" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/40"
        >
          {label}
        </label>
        <select
          id={id}
          className={cn(
            "-ml-0.5 w-full cursor-pointer appearance-none truncate rounded bg-transparent",
            "pl-0.5 pr-1 text-sm font-semibold text-white outline-none",
            // Gives the native option list a dark popup to match the console.
            "[color-scheme:dark]",
          )}
          {...props}
        >
          {children}
        </select>
      </span>
      <ChevronDown
        className="size-4 shrink-0 text-white/35 transition-colors group-hover:text-white/70"
        aria-hidden="true"
      />
    </div>
  );
}

/** Same cell shape as a refinement, but free text and its own rounded card. */
function ConsoleInput({ icon: Icon, label, className, ...props }) {
  const id = useId();

  return (
    <div
      className={cn(
        "flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-night-soft/85 px-4 py-2",
        "transition-colors duration-200 focus-within:border-white/25 focus-within:bg-white/[0.09]",
        className,
      )}
    >
      <Icon className="size-4 shrink-0 text-brand-300" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <label
          htmlFor={id}
          className="block text-[10px] font-bold uppercase tracking-[0.14em] text-white/40"
        >
          {label}
        </label>
        <input
          id={id}
          className={cn(
            "w-full bg-transparent text-sm font-semibold text-white outline-none",
            "placeholder:font-normal placeholder:text-white/35",
          )}
          {...props}
        />
      </span>
    </div>
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
      <Search
        className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-brand-300"
        aria-hidden="true"
      />
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
        placeholder="Course name or code, e.g. MHF4U"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls="hero-course-results"
        aria-autocomplete="list"
        aria-activedescendant={highlighted >= 0 ? `hero-course-${highlighted}` : undefined}
        className={cn(
          "h-[3.75rem] w-full rounded-2xl border border-white/10 bg-night-soft/85 pl-14 pr-5 sm:pr-24",
          "text-base font-semibold text-white outline-none",
          "placeholder:font-normal placeholder:text-white/40",
          "transition-colors duration-200",
          "hover:border-white/20 focus:border-brand-400/60 focus:bg-white/[0.09]",
          "focus:ring-4 focus:ring-brand-500/15",
        )}
      />

      {/* Return-key affordance — it disappears the moment there is a spinner
          or the field is empty, so it never competes for the same corner. */}
      {!loading && value.trim().length > 0 && (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-md border border-white/15 bg-white/[0.08] px-2 py-1 text-[10px] font-semibold text-white/50 sm:flex"
        >
          <CornerDownLeft className="size-3" />
          Enter
        </kbd>
      )}
      {loading && (
        <Loader2 className="absolute right-5 top-1/2 size-4 -translate-y-1/2 animate-spin text-brand-300" />
      )}

      {open && (
        <ul
          id="hero-course-results"
          role="listbox"
          aria-label="Search suggestions"
          className={cn(
            "absolute inset-x-0 top-full z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl p-1.5",
            // Opaque, not glass: the list sits over the console's own controls
            // and anything showing through reads as a rendering fault.
            "border border-white/10 bg-night-soft",
            "shadow-[0_30px_60px_-20px_rgb(2_6_23/0.95)]",
          )}
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
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  index === highlighted ? "bg-white/10" : "hover:bg-white/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                    item.type === "COURSE"
                      ? "bg-brand-500/15 text-brand-200 ring-brand-400/25"
                      : "bg-accent-500/15 text-accent-300 ring-accent-400/25",
                  )}
                >
                  {item.type === "COURSE" ? (
                    <BookOpen className="size-4" />
                  ) : (
                    <GraduationCap className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {item.label}
                  </span>
                  <span className="block truncate text-xs text-white/45">{item.sublabel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
