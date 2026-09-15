import Link from "next/link";
import { FOOTER_NAV, SITE } from "@/constants";
import { Logo } from "./Logo";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-ink-200 bg-white">
      <div className="container-page py-12 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              Canada&rsquo;s tutoring marketplace for the actual courses your child is taking —
              matched by province, grade and course code.
            </p>
            <div className="mt-5 space-y-1 text-sm">
              <a
                href={`mailto:${SITE.supportEmail}`}
                className="block font-medium text-brand-600 hover:underline"
              >
                {SITE.supportEmail}
              </a>
              <a href={`tel:${SITE.supportPhone}`} className="block text-ink-500 hover:text-ink-700">
                {SITE.supportPhone}
              </a>
            </div>
          </div>

          {FOOTER_NAV.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-ink-900">
                {group.title}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-500 transition-colors hover:text-brand-600"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-ink-100 pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-500">
            © {year} {SITE.name}. Built in Canada 🇨🇦
          </p>
          <p className="text-xs text-ink-400">
            Tutors are independent contractors, not employees of {SITE.name}.
          </p>
        </div>
      </div>
    </footer>
  );
}
