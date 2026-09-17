import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, Star, MapPin, BookOpen, TrendingUp } from "lucide-react";
import { HeroSearch } from "@/components/search/HeroSearch";
import { Avatar, Reveal } from "@/components/ui";
import { formatNumber } from "@/lib/utils/format";
import heroImage from "../../../public/hero/study-hall.jpg";
import heroImage2 from "../../../public/hero/iewek-gnos.jpg";

/**
 * Homepage hero (§12).
 *
 * Search is the hero's job — the copy earns the search box, not the other way
 * around. Anyone can search without an account.
 *
 * The section deliberately runs up underneath the sticky header (the negative
 * top margin) so the dark ground is full-bleed; `SiteHeader` switches to its
 * inverse tone while it is sitting on top of this.
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
        "relative isolate overflow-hidden bg-night-deep",
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
            <h1 className="mt-6 text-[2.15rem] font-extrabold leading-[1.07] tracking-[-0.03em] text-white sm:text-5xl lg:text-[3.5rem]">
              The right tutor for{" "}
              <span className="relative inline-block">
                {/* The bloom sits behind the words rather than under them, so
                    the gradient type looks lit instead of underlined. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-x-6 -inset-y-3 -z-10 rounded-full bg-accent-400/25 blur-2xl"
                />
                <span className="bg-gradient-to-r from-white via-accent-200 to-accent-400 bg-clip-text pb-[0.08em] text-transparent">
                  the exact course
                </span>
              </span>{" "}
              your child is taking
            </h1>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-brand-50/85 sm:max-w-2xl sm:text-lg">
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
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/45">
                <TrendingUp className="size-3.5" aria-hidden="true" />
                Popular right now
              </span>
              {popularCourses.slice(0, 5).map((course) => (
                <Link
                  key={course.id}
                  href={`/find-a-tutor?courseCode=${course.code}&province=ON`}
                  className={[
                    "rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5",
                    "text-xs font-semibold tracking-wide text-white/80 backdrop-blur-md",
                    "transition duration-200 hover:-translate-y-0.5 hover:border-white/25",
                    "hover:bg-white/[0.14] hover:text-white motion-reduce:hover:translate-y-0",
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
 * A photograph of library stacks, then everything needed to stop it behaving
 * like a photograph: it is blurred and desaturated down to texture, pushed
 * under a navy scrim heavy enough that white type clears AA contrast anywhere
 * on it, and lit with a single warm bloom. The grid survives from the previous
 * version but at a third of the strength — over an image it is a hint of
 * structure, not a pattern.
 *
 * The scrim is the load-bearing part. Swapping the photo is safe; thinning
 * these overlays is not.
 */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* On a phone the section is portrait, and covering it with a 16:9 frame
          crops to the dark middle of the corridor — the library disappears. So
          the photo is capped to the top of the section and anchored left, onto
          the lit shelves, then faded into the navy the rest of the hero sits on.
          From `sm` up the frame is wide enough to use the whole composition. */}
      <div className="absolute inset-x-0 top-0 h-[46%] sm:inset-0 sm:h-auto">
        {/* `priority` because this is the LCP element on the homepage. */}
        <Image
          src={heroImage2}
          alt=""
          fill
          priority
          sizes="100vw"
          placeholder="blur"
          className="scale-105 object-cover object-[32%_50%] brightness-[0.62] saturate-[0.4] blur-[1.5px] sm:object-center"
        />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-b from-transparent to-night sm:hidden" />
      </div>

      {/* Duotone, not a dark wash. `mix-blend-color` keeps the photograph's
          luminance — the shelves, the corridor, the figure all still read —
          while forcing every hue in it to the brand navy. Darkening alone left
          the library's browns and reds fighting the palette. */}
      <div className="absolute inset-0 bg-brand-950 mix-blend-color" />

      {/* Contrast floor for the white type, then a ramp so the section is
          darkest where the stats sit and the page hands over to light. */}
      {/* Lighter on phones: there the photo only occupies the top of the
          section, so it can carry less scrim and still stay behind the copy. */}
      <div className="absolute inset-0 bg-night/45 sm:bg-night/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-night/40 via-transparent to-night-deep" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_85%_at_50%_40%,transparent_28%,var(--color-night-deep)_100%)]" />

      {/* A plate under the copy column. Dimming the whole photo far enough for
          body text would have flattened it; this darkens only the centre,
          where the headline and paragraph actually sit. */}
      <div className="absolute inset-0 bg-[radial-gradient(50%_42%_at_50%_30%,rgba(10,15,29,0.72),transparent_72%)]" />

      {/* Structure, faintly. */}
      <div className="absolute inset-0 opacity-[0.3] hero-grid [mask-image:radial-gradient(70%_60%_at_50%_25%,#000_10%,transparent_70%)]" />

      {/* The single warm note: one amber bloom behind the headline, reading as
          light falling down the corridor rather than as a coloured panel. */}
      <div className="absolute left-1/2 top-[14%] size-[18rem] -translate-x-1/2 rounded-full bg-accent-500/20 blur-[90px] mix-blend-screen animate-drift-a sm:size-[28rem] sm:blur-[120px]" />
      <div className="absolute -bottom-52 -left-24 hidden size-[32rem] rounded-full bg-brand-500/25 blur-[130px] mix-blend-screen animate-drift-b sm:block" />

      {/* Film grain — the one thing that stops a blurred photo under a flat
          wash reading as a compression artefact. */}
      <div
        className="absolute inset-0 opacity-[0.14] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.45'/%3E%3C/svg%3E\")",
        }}
      />

      {/* Settle the foot of the section, so the edge against the light page
          below reads as intentional. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-night-deep" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-400/30 to-transparent" />
    </div>
  );
}

/** The verification badge: glass pill, live indicator, one slow glint. */
function TrustPill() {
  return (
    <span
      className={[
        "relative inline-flex items-center gap-2.5 overflow-hidden rounded-full",
        "border border-white/10 bg-white/[0.07] py-1.5 pl-3 pr-4",
        "text-xs font-semibold text-brand-50 backdrop-blur-md",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.12),0_8px_24px_-12px_rgb(0_0_0/0.9)]",
      ].join(" ")}
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inset-0 rounded-full bg-success-500 animate-halo" />
        <span className="relative size-2 rounded-full bg-success-500 shadow-[0_0_10px_2px_rgb(34_197_94/0.6)]" />
      </span>
      <ShieldCheck className="size-3.5 shrink-0 text-brand-200" aria-hidden="true" />
      Every tutor ID-checked before they appear
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-sheen"
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
                className="ring-2 ring-night-deep"
              />
            ))}
          </span>
          <span className="text-left">
            <span className="block text-sm font-bold leading-tight text-white">
              {formatNumber(stats.tutorCount)} tutors
            </span>
            <span className="block text-[11px] leading-tight text-white/50">
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
            <span className="block text-sm font-bold leading-tight text-white">
              {rating}/5 average
            </span>
            <span className="block text-[11px] leading-tight text-white/50">
              from {formatNumber(stats.reviewCount)} verified reviews
            </span>
          </span>
        </GlassBadge>
      )}

      <GlassBadge>
        <span className="flex size-8 items-center justify-center rounded-full bg-success-500/15 text-success-500 ring-1 ring-inset ring-success-500/25">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <span className="text-left">
          <span className="block text-sm font-bold leading-tight text-white">100% ID verified</span>
          <span className="block text-[11px] leading-tight text-white/50">
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
        "flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2",
        "backdrop-blur-xl transition duration-300 hover:border-white/20 hover:bg-white/[0.1]",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08),0_18px_40px_-24px_rgb(0_0_0/0.9)]",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function HeroStat({ icon, value, label }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-4 text-center backdrop-blur-sm">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="mx-auto mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.07] text-brand-200 ring-1 ring-inset ring-white/10">
          {icon}
        </span>
        <span className="block text-2xl font-extrabold tracking-tight text-white tabular-nums">
          {value}
        </span>
        <span className="mt-0.5 block text-xs font-medium text-white/45">{label}</span>
      </dd>
    </div>
  );
}
