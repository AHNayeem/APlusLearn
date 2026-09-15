import Link from "next/link";
import { Search, Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { Logo } from "@/components/layout/Logo";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/** Global 404. Offers the routes people actually want, not just an apology. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="container-page py-6">
        <Logo />
      </header>

      <main id="main" className="container-page flex flex-1 items-center py-16">
        <div className="mx-auto max-w-lg text-center">
          <p className="text-7xl font-extrabold tracking-tight text-brand-200">404</p>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            We couldn&rsquo;t find that page
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            The link may be out of date, or the tutor profile may no longer be available. Here are
            a few places that might help.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href="/find-a-tutor" size="lg" iconLeft={<Search className="size-4" />}>
              Find a tutor
            </Button>
            <Button href="/" variant="secondary" size="lg" iconLeft={<Home className="size-4" />}>
              Go home
            </Button>
          </div>

          <ul className="mt-10 space-y-2 border-t border-ink-200 pt-8 text-left">
            {[
              { href: "/courses", label: "Browse every course we cover" },
              { href: "/how-it-works", label: "How APlus Learn works" },
              { href: "/become-a-tutor", label: "Apply to become a tutor" },
              { href: "/support", label: "Contact support" },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
                >
                  {link.label}
                  <ArrowRight className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
