import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, Star, MapPin, BookOpen, TrendingUp } from "lucide-react";
import { HeroSearch } from "@/components/search/HeroSearch";
import { Avatar, Reveal } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";
import heroImage from "../../../public/hero/iewek-gnos.jpg";

/**
 * Homepage hero (§12).
 *
 * Search is the hero's job — the copy earns the search box, not the other way
 * around. Anyone can search without an account.
 *
 * The section runs up underneath the sticky header (the negative top margin)
 * so its ground is full-bleed. The header needs no special treatment over it,
 * because the hero is light.
 */
export function Hero({
  provinces,
  grades,
  subjects,
  stats,
  popularCourses = [],
  topTutors = [],
}) {
  const rating = stats.averageRating ? stats.averageRating.toFixed(1) : null;

  return (
    <section
      className={[
        "relative isolate overflow-hidden bg-mist",
        "-mt-[var(--header-height)] pt-[calc(var(--header-height)+1.75rem)]",
        "pb-14 lg:pb-20 lg:pt-[calc(var(--header-height)+3.25rem)]",
      ].join(" ")}
    >
      <HeroBackdrop />

      <div className="container-page relative">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <TrustPill />
          </Reveal>

          <Reveal delay={0.06}>
            <h1 className="mt-6 text-[2.15rem] font-extrabold leading-[1.07] tracking-[-0.03em] text-ink-900 sm:text-5xl lg:text-[3.5rem]">
              The right tutor for{" "}
              <span className="relative inline-block">
                {/* The bloom sits behind the words rather than under them, so
                    the gradient type looks lit instead of underlined. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-x-6 -inset-y-3 -z-10 rounded-full bg-accent-300/40 blur-2xl"
                />
                <span className="bg-gradient-to-r from-brand-700 via-brand-500 to-accent-500 bg-clip-text pb-[0.08em] text-transparent">
                  the exact course
                </span>
              </span>{" "}
              your child is taking
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-ink-600 sm:max-w-2xl sm:text-lg">
              Search by province, grade and course code — not vague subject labels. Compare
              verified Canadian tutors, message them free, and book online or in person.
            </p>
          </Reveal>
        </div>

        <Reveal delay={0.18} className="mx-auto mt-8 max-w-5xl lg:mt-10">
          <HeroSearch provinces={provinces} grades={grades} subjects={subjects} />
        </Reveal>

        {popularCourses.length > 0 && (
          <Reveal delay={0.24} className="mx-auto mt-5 max-w-5xl">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-500">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                Popular right now
              </span>
              {popularCourses.slice(0, 5).map((course) => (
                <Link
                  key={course.id}
                  href={`/find-a-tutor?courseCode=${course.code}&province=ON`}
                  className={[
                    "rounded-full border border-ink-200 bg-white/75 px-3.5 py-1.5",
                    "text-xs font-semibold tracking-wide text-ink-700 shadow-xs backdrop-blur-md",
                    "transition duration-200 hover:-translate-y-0.5 hover:border-brand-300",
                    "hover:bg-white hover:text-brand-700 motion-reduce:hover:translate-y-0",
                  ].join(" ")}
                >
                  {course.code ?? course.name}
                </Link>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal delay={0.3} className="mt-7 lg:mt-9">
          <TrustStrip tutors={topTutors} stats={stats} rating={rating} />
        </Reveal>

        <Reveal delay={0.36}>
          <dl className="mx-auto mt-6 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <HeroStat
              icon={<ShieldCheck className="size-4" />}
              value={formatNumber(stats.tutorCount)}
              label="Verified tutors"
            />
            <HeroStat
              icon={<Star className="size-4" />}
              value={rating ?? "—"}
              label="Average rating"
            />
            <HeroStat
              icon={<MapPin className="size-4" />}
              value={formatNumber(stats.cityCount)}
              label="Cities served"
            />
            <HeroStat
              icon={<BookOpen className="size-4" />}
              value={formatNumber(stats.courseCount)}
              label="Courses covered"
            />
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The hero's atmosphere.
 *
 * A photograph of a lamp-lit study desk, bleached back until it is texture
 * rather than a picture: brightened, half-desaturated, blurred and held at low
 * opacity over a cool white ground. Its warmth is the point — it survives as a
 * peach glow on one side, which is what stops a white hero reading as an empty
 * page, and it is the same warm note as the amber in the headline.
 *
 * The white wash and the plate under the copy are load-bearing: they are what
 * keep body text above AA. Swapping the photo is safe; thinning those is not.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* On a phone the section is portrait, and covering it with a landscape
          frame crops to an empty patch of desk. So the photo is capped to the
          top of the section and anchored onto the laptop and open book, then
          faded into the white the rest of the hero sits on. From `sm` up the
          frame is wide enough for the whole composition. */}
      <div className="absolute inset-x-0 top-0 h-[46%] sm:inset-0 sm:h-auto">
        {/* `priority` because this is the LCP element on the homepage. */}
        <Image
          src={heroImage}
          alt=""
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          className="scale-105 object-cover object-[46%_62%] opacity-[0.28] brightness-[1.35] saturate-[0.55] blur-[2px] sm:object-[50%_58%]"
        />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-b from-transparent to-mist sm:hidden" />
      </div>

      {/* Contrast floor, then a ramp so the section brightens toward the foot
          and hands over cleanly to the page below. */}
      <div className="absolute inset-0 bg-white/45 sm:bg-white/40" />
      <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-transparent to-mist" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_40%,transparent_30%,var(--color-mist)_100%)]" />

      {/* A plate under the copy column. Washing the whole photo out far enough
          for body text would have erased it; this lifts only the centre, where
          the headline and paragraph actually sit. */}
      <div className="absolute inset-0 bg-[radial-gradient(50%_42%_at_50%_30%,rgb(255_255_255/0.9),transparent_72%)]" />

      {/* Structure, faintly. */}
      <div className="absolute inset-0 opacity-[0.45] hero-grid [mask-image:radial-gradient(70%_60%_at_50%_25%,#000_10%,transparent_70%)]" />

      {/* Two soft blooms: the warm one behind the headline, picking up the
          lamp in the photo, and a cool brand one low and off-centre so the
          white never settles into grey. */}
      <div className="absolute left-1/2 top-[12%] size-[20rem] -translate-x-1/2 rounded-full bg-accent-200/55 blur-[90px] animate-drift-a sm:size-[32rem] sm:blur-[120px]" />
      <div className="absolute -bottom-52 -left-24 hidden size-[32rem] rounded-full bg-brand-200/60 blur-[130px] animate-drift-b sm:block" />

      {/* Settle the foot of the section, so the seam against the next section
          reads as intentional. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-mist-deep/70" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-ink-300/60 to-transparent" />
    </div>
  );
}

/** The verification badge: frosted pill, live indicator, one slow glint. */
function TrustPill() {
  return (
    <span
      className={[
        "relative inline-flex items-center gap-2.5 overflow-hidden rounded-full",
        "border border-ink-200/80 bg-white/80 py-1.5 pl-3 pr-4",
        "text-xs font-semibold text-ink-700 backdrop-blur-md",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9),0_8px_24px_-14px_rgb(15_23_42/0.45)]",
      ].join(" ")}
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 rounded-full bg-success-500 animate-halo" />
        <span className="relative size-2 rounded-full bg-success-500 shadow-[0_0_8px_1px_rgb(34_197_94/0.5)]" />
      </span>
      <ShieldCheck className="size-3.5 shrink-0 text-brand-600" aria-hidden="true" />
      Every tutor ID-checked before they appear
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/75 to-transparent animate-sheen"
      />
    </span>
  );
}

/**
 * Floating proof under the console. Every number here is real — the avatars
 * are the current top-rated tutors and the rating is the live average — so
 * this row stays honest as the marketplace grows.
 */
function TrustStrip({ tutors, stats, rating }) {
  const shown = tutors.slice(0, 4);

  return (
    <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-3">
      {shown.length > 0 && (
        <GlassBadge>
          {/* Overlap is kept loose enough that a two-letter initial fallback
              still reads — most seeded tutors have no photo. */}
          <span className="flex -space-x-2">
            {shown.map((tutor) => (
              <Avatar
                key={tutor.id}
                src={tutor.avatarUrl}
                name={tutor.displayName}
                size="sm"
                className="ring-2 ring-white"
              />
            ))}
          </span>
          <span className="text-left">
            <span className="block text-sm font-bold leading-tight text-ink-900">
              {formatNumber(stats.tutorCount)} tutors
            </span>
            <span className="block text-[11px] leading-tight text-ink-500">
              accepting students now
            </span>
          </span>
        </GlassBadge>
      )}

      {rating && (
        <GlassBadge>
          <span className="flex items-center gap-0.5" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} className="size-3.5 fill-accent-400 text-accent-400" />
            ))}
          </span>
          <span className="text-left">
            <span className="block text-sm font-bold leading-tight text-ink-900">
              {rating}/5 average
            </span>
            <span className="block text-[11px] leading-tight text-ink-500">
              from {formatNumber(stats.reviewCount)} verified reviews
            </span>
          </span>
        </GlassBadge>
      )}

      <GlassBadge>
        <span className="flex size-8 items-center justify-center rounded-full bg-success-50 text-success-600 ring-1 ring-inset ring-success-500/25">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <span className="text-left">
          <span className="block text-sm font-bold leading-tight text-ink-900">
            100% ID verified
          </span>
          <span className="block text-[11px] leading-tight text-ink-500">
            background and reference checked
          </span>
        </span>
      </GlassBadge>
    </div>
  );
}

function GlassBadge({ children }) {
  return (
    <div
      className={[
        "flex items-center gap-3 rounded-2xl border border-ink-200/80 bg-white/80 px-4 py-2",
        "backdrop-blur-xl transition duration-300 hover:border-brand-200 hover:bg-white",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9),0_18px_40px_-26px_rgb(15_23_42/0.5)]",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function HeroStat({ icon, value, label }) {
  return (
    <div className="rounded-2xl border border-ink-200/70 bg-white/70 px-3 py-4 text-center shadow-xs backdrop-blur-sm">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="mx-auto mb-2 flex size-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
          {icon}
        </span>
        <span className="block text-2xl font-extrabold tracking-tight text-ink-900 tabular-nums">
          {value}
        </span>
        <span className="mt-0.5 block text-xs font-medium text-ink-500">{label}</span>
      </dd>
    </div>
  );
}
