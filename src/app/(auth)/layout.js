import Link from "next/link";
import { ShieldCheck, Star, Users } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { enforceGuest } from "@/lib/auth/guards";
import { marketplaceStats } from "@/services/search.service";
import { connectToDatabase } from "@/lib/db/connect";
import { formatNumber } from "@/lib/utils/format";
import { getAppConfig } from "@/services/settings.service";

/**
 * Split auth layout: the form on the left, reassurance on the right.
 * Signed-in visitors are redirected to their own dashboard.
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

      <aside className="relative hidden overflow-hidden bg-ink-900 lg:flex lg:w-[42%] lg:flex-col lg:justify-center lg:px-12">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(60rem_40rem_at_20%_10%,var(--color-brand-800),transparent_65%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(40rem_30rem_at_90%_80%,var(--color-brand-600),transparent_60%)] opacity-50" />
        </div>

        <div className="relative max-w-sm">
          <h2 className="text-3xl font-extrabold leading-tight tracking-tight text-white">
            The tutoring marketplace built around Canadian curriculum
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-brand-100/80">
            Search by the exact course code on your child&rsquo;s report card. Compare tutors whose
            credentials we&rsquo;ve actually checked. Book, pay and track it all in one place.
          </p>

          <dl className="mt-10 space-y-6">
            <Stat
              icon={<ShieldCheck className="size-4" />}
              value={formatNumber(stats.tutorCount)}
              label="Verified tutors, ID-checked before they appear"
            />
            <Stat
              icon={<Users className="size-4" />}
              value={formatNumber(stats.cityCount)}
              label="Cities across Ontario and growing"
            />
            <Stat
              icon={<Star className="size-4" />}
              value={formatNumber(stats.subjectCount)}
              label="Subjects, from Grade 1 reading to MCV4U"
            />
          </dl>
        </div>
      </aside>
    </div>
  );
}

function Stat({ icon, value, label }) {
  return (
    <div className="flex gap-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-brand-200">
        {icon}
      </span>
      <div>
        <dt className="text-xl font-extrabold text-white tabular-nums">{value}</dt>
        <dd className="mt-0.5 text-xs leading-relaxed text-brand-200/70">{label}</dd>
      </div>
    </div>
  );
}
