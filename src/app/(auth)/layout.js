import Image from "next/image";
import Link from "next/link";
import { ShieldCheck, Star, Users, BookOpen, MapPin } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { Reveal } from "@/components/ui";
import { enforceGuest } from "@/lib/auth/guards";
import { marketplaceStats } from "@/services/search.service";
import { connectToDatabase } from "@/lib/db/connect";
import { formatNumber } from "@/lib/utils/format";
import { getAppConfig } from "@/services/settings.service";
import asideImage from "../../../public/hero/study-hall.jpg";

/**
 * Split auth layout: the form on the left, reassurance on the right.
 * Signed-in visitors are redirected to their own dashboard.
 *
 * The right column is the homepage hero's world, narrowed: the same bleached
 * photograph under a white wash, the same warm bloom behind a gradient
 * headline, the same frosted stat plates. Someone arriving from `/` should not
 * feel they have crossed into a different product at the sign-in door.
 */
export default async function AuthLayout({ children }) {
  await enforceGuest();
  await connectToDatabase();
  const [stats, config] = await Promise.all([marketplaceStats(), getAppConfig()]);

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="flex flex-1 flex-col px-5 py-8 sm:px-8 lg:px-12">
        <header className="mb-10">
          <Logo branding={config.branding} />
        </header>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
          {children}
        </main>
        <footer className="mx-auto mt-10 w-full max-w-md text-xs text-ink-400">
          <p>
            By continuing you agree to our{" "}
            <Link href="/legal/terms" className="underline hover:text-ink-600">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="underline hover:text-ink-600">
              Privacy Policy
            </Link>
            .
          </p>
        </footer>
      </div>

      <aside
        className={[
          "relative isolate hidden overflow-hidden bg-mist",
          "lg:flex lg:w-[44%] lg:flex-col lg:justify-center lg:px-12 xl:px-16",
          "lg:border-l lg:border-ink-200/70",
          // Pinned to the viewport: the register form is much taller than the
          // sign-in one, and a centred panel would otherwise drift off-screen
          // as it scrolls. `self-start` is what lets a flex child stick at all.
          "lg:sticky lg:top-0 lg:h-dvh lg:self-start",
        ].join(" ")}
      >
        <AsideBackdrop />

        <div className="relative mx-auto w-full max-w-md py-12">
          <Reveal>
            <TrustPill />
          </Reveal>

          <Reveal delay={0.06}>
            <h2 className="mt-6 text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 xl:text-[2.4rem]">
              Built around the{" "}
              <span className="relative inline-block">
                {/* Same construction as the homepage headline: the bloom sits
                    behind the words so the gradient type reads as lit, and the
                    gradient stops at brand-500 because brand-400 falls under
                    the 3:1 floor for large text on this ground. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-x-5 -inset-y-3 -z-10 rounded-full bg-accent-200/45 blur-2xl"
                />
                <span className="bg-gradient-to-r from-brand-800 via-brand-700 to-brand-500 bg-clip-text pb-[0.08em] text-transparent">
                  Canadian curriculum
                </span>
              </span>
            </h2>
          </Reveal>

          <Reveal delay={0.12}>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
              Search by the exact course code on your child&rsquo;s report card. Compare tutors
              whose credentials we&rsquo;ve actually checked. Book, pay and track it all in one
              place.
            </p>
          </Reveal>

          <Reveal delay={0.18}>
            <dl className="mt-9 grid grid-cols-2 gap-3">
              <Stat
                icon={<ShieldCheck className="size-4" />}
                value={formatNumber(stats.tutorCount)}
                label="Verified tutors"
              />
              <Stat
                icon={<MapPin className="size-4" />}
                value={formatNumber(stats.cityCount)}
                label="Cities served"
              />
              <Stat
                icon={<Star className="size-4" />}
                value={formatNumber(stats.subjectCount)}
                label="Subjects covered"
              />
              <Stat
                icon={<BookOpen className="size-4" />}
                value={formatNumber(stats.courseCount)}
                label="Course codes"
              />
            </dl>
          </Reveal>

          <Reveal delay={0.24}>
            <div
              className={[
                "mt-4 flex items-center gap-3 rounded-2xl border border-ink-200/80 bg-white/80 px-4 py-3",
                "backdrop-blur-xl transition duration-300 hover:border-brand-200 hover:bg-white",
                "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.9),0_18px_40px_-26px_rgb(15_23_42/0.5)]",
              ].join(" ")}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-50 text-success-600 ring-1 ring-inset ring-success-500/25">
                <Users className="size-4" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-bold leading-tight text-ink-900">
                  Free to join, free to message
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-ink-500">
                  You only pay once you book a lesson
                </span>
              </span>
            </div>
          </Reveal>
        </div>
      </aside>
    </div>
  );
}

/**
 * The column's atmosphere — the homepage `HeroBackdrop` recomposed for a tall,
 * narrow frame. The photograph is bleached back until it is texture rather
 * than a picture, and the white wash plus the plate behind the copy are what
 * hold body text above AA. Swapping the photo is safe; thinning those is not.
 *
 * No `priority` here: the sign-in form is the LCP element, and this is
 * decoration behind it.
 */
function AsideBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <Image
        src={asideImage}
        alt=""
        fill
        sizes="44vw"
        placeholder="blur"
        className="scale-105 object-cover object-[55%_40%] opacity-[0.18] brightness-[1.4] saturate-[0.35] blur-[3px]"
      />

      {/* Contrast floor, then a ramp so the column settles into the mist at
          both ends instead of stopping at a hard edge. */}
      <div className="absolute inset-0 bg-white/45" />
      <div className="absolute inset-0 bg-gradient-to-b from-mist via-transparent to-mist" />
      <div className="absolute inset-0 bg-[radial-gradient(110%_75%_at_50%_45%,transparent_20%,var(--color-mist)_100%)]" />

      {/* A plate under the copy column: washing the whole photo out far enough
          for body text would have erased it, so this lifts only the middle. */}
      <div className="absolute inset-0 bg-[radial-gradient(80%_50%_at_50%_45%,rgb(255_255_255/0.92),transparent_78%)]" />

      {/* Structure, faintly. */}
      <div className="absolute inset-0 opacity-[0.45] hero-grid [mask-image:radial-gradient(80%_55%_at_50%_35%,#000_10%,transparent_75%)]" />

      {/* The warm bloom behind the headline and a cool brand one low down, so
          the white never settles into grey — the same pair as the hero. */}
      <div className="absolute left-1/2 top-[18%] size-[26rem] -translate-x-1/2 rounded-full bg-accent-200/40 blur-[110px] animate-drift-a" />
      <div className="absolute -bottom-40 -right-24 size-[28rem] rounded-full bg-brand-200/60 blur-[130px] animate-drift-b" />

      {/* Seam against the form column. */}
      <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-ink-300/60 to-transparent" />
    </div>
  );
}

/** Frosted verification pill — live indicator and one slow glint, as on the homepage. */
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

function Stat({ icon, value, label }) {
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
