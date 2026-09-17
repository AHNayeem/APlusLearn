import Link from "next/link";
import { Search, Home, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";

/** The routes people actually want when they hit a dead link. */
const SUGGESTIONS = [
  { href: "/courses", label: "Browse every course we cover" },
  { href: "/how-it-works", label: "How APlus Learn works" },
  { href: "/become-a-tutor", label: "Apply to become a tutor" },
  { href: "/support", label: "Contact support" },
];

/**
 * The 404 message, with no page chrome of its own (§32).
 *
 * Deliberately headerless. `notFound()` renders the nearest `not-found.js`
 * *inside* the layouts above the segment that threw, so every boundary below a
 * layout that already draws a header — the public site bar, the dashboard rail
 * — must contribute the message only, or the viewport gets two stacked
 * headers. Only `app/not-found.js` adds chrome, because an unmatched top-level
 * URL renders in the bare root layout where there is none.
 */
export function NotFoundBody() {
  return (
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
        {SUGGESTIONS.map((link) => (
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
  );
}
