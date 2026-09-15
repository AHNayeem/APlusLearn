import Link from "next/link";
import { ShieldCheck, Star, MapPin } from "lucide-react";
import { HeroSearch } from "@/components/search/HeroSearch";
import { Reveal } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";

/**
 * Homepage hero (§12).
 *
 * Search is the hero's job — the copy earns the search box, not the other way
 * around. Anyone can search without an account.
 */
export function Hero({ provinces, grades, subjects, stats, popularCourses = [] }) {
  return (
    <section className="relative overflow-hidden bg-ink-900 pb-16 pt-12 lg:pb-24 lg:pt-16">
      {/* Layered gradients rather than an image: fast, crisp at any size. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(90rem_45rem_at_15%_-10%,var(--color-brand-800),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60rem_35rem_at_95%_10%,var(--color-brand-600),transparent_55%)] opacity-60" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-ink-950/40" />
      </div>

      <div className="container-page relative">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-brand-100 ring-1 ring-inset ring-white/15 backdrop-blur-sm">
              <ShieldCheck className="size-3.5" />
              Every tutor ID-checked before they appear
            </span>
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
              The right tutor for{" "}
              <span className="relative whitespace-nowrap">
                <span className="relative z-10 text-accent-300">the exact course</span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 320 12"
                  className="absolute -bottom-1 left-0 z-0 w-full text-accent-500/40"
                  preserveAspectRatio="none"
                >
                  <path d="M2 9C80 3 240 3 318 7" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
                </svg>
              </span>{" "}
              your child is taking
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-brand-100/90 sm:text-lg">
              Search by province, grade and course code — not vague subject labels. Compare
              verified Canadian tutors, message them free, and book online or in person.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.18} className="mx-auto mt-9 max-w-4xl">
          <HeroSearch provinces={provinces} grades={grades} subjects={subjects} />
        </Reveal>

        {popularCourses.length > 0 && (
          <Reveal delay={0.24} className="mx-auto mt-6 max-w-4xl">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs font-semibold text-brand-200/80">Popular right now:</span>
              {popularCourses.slice(0, 5).map((course) => (
                <Link
                  key={course.id}
                  href={`/find-a-tutor?courseCode=${course.code}&province=ON`}
                  className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/20"
                >
                  {course.code ?? course.name}
                </Link>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal delay={0.3}>
          <dl className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-6 border-t border-white/10 pt-8 sm:grid-cols-4">
            <HeroStat
              icon={<ShieldCheck className="size-4" />}
              value={formatNumber(stats.tutorCount)}
              label="Verified tutors"
            />
            <HeroStat
              icon={<Star className="size-4" />}
              value={stats.averageRating ? stats.averageRating.toFixed(1) : "4.9"}
              label="Average rating"
            />
            <HeroStat
              icon={<MapPin className="size-4" />}
              value={formatNumber(stats.cityCount)}
              label="Cities served"
            />
            <HeroStat
              icon={<span className="text-sm font-black">A+</span>}
              value={formatNumber(stats.courseCount)}
              label="Courses covered"
            />
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

function HeroStat({ icon, value, label }) {
  return (
    <div className="text-center">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="mx-auto mb-2 flex size-8 items-center justify-center rounded-lg bg-white/10 text-brand-200">
          {icon}
        </span>
        <span className="block text-2xl font-extrabold tracking-tight text-white tabular-nums">
          {value}
        </span>
        <span className="mt-0.5 block text-xs font-medium text-brand-200/80">{label}</span>
      </dd>
    </div>
  );
}
