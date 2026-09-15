import Link from "next/link";
import { Mail, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import {
  FOOTER_LEGAL_LINKS,
  FOOTER_ONLINE_LINKS,
  FOOTER_SUBJECT_LINKS,
  FOOTER_USEFUL_LINKS,
  SITE,
} from "@/constants";
import { Logo } from "./Logo";

/**
 * Marketing footer (§29 discovery links, §42 legal links).
 *
 * Four bands on a deep plum ground: identity + contact, subject and online
 * discovery, useful links / app / newsletter, then the legal bar. Every link
 * is a real route — the subject and course links are plain search URLs so the
 * footer never touches the database on a page render.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  const social = [
    { label: "Facebook", href: SITE.social?.facebook, Mark: FacebookMark },
    { label: "X", href: SITE.social?.x, Mark: XMark },
    { label: "LinkedIn", href: SITE.social?.linkedin, Mark: LinkedInMark },
    { label: "Instagram", href: SITE.social?.instagram, Mark: InstagramMark },
    { label: "YouTube", href: SITE.social?.youtube, Mark: YouTubeMark },
  ].filter((item) => item.href);

  return (
    <footer className="mt-auto bg-footer text-white/70">
      <div className="container-page py-14 lg:py-20">
        {/* --- Identity + contact ------------------------------------------ */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <div className="max-w-xl">
            <Logo tone="inverse" />
            <p className="mt-5 text-sm leading-relaxed text-white/60">
              {SITE.description}
            </p>

            {social.length > 0 && (
              <ul className="mt-7 flex flex-wrap gap-3">
                {social.map(({ label, href, Mark }) => (
                  <li key={label}>
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={`${SITE.name} on ${label}`}
                      className="flex size-11 items-center justify-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-white hover:bg-white hover:text-footer"
                    >
                      <Mark />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Feel free to share your question</h2>
            <ul className="mt-6 space-y-4 text-sm">
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Phone className="size-4 shrink-0 text-white/45" aria-hidden="true" />
                <a href={`tel:${SITE.supportPhone}`} className="text-white hover:text-accent-300">
                  {SITE.supportPhone}
                </a>
                <span className="text-white/45">( {SITE.supportHours} )</span>
              </li>
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Mail className="size-4 shrink-0 text-white/45" aria-hidden="true" />
                <a
                  href={`mailto:${SITE.supportEmail}`}
                  className="text-white hover:text-accent-300"
                >
                  {SITE.supportEmail}
                </a>
              </li>
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <MessageCircle className="size-4 shrink-0 text-white/45" aria-hidden="true" />
                <Link href="/support" className="text-white hover:text-accent-300">
                  Help centre &amp; live chat
                </Link>
                <span className="text-white/45">( replies within 4 hours )</span>
              </li>
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <MapPin className="size-4 shrink-0 text-white/45" aria-hidden="true" />
                <span className="text-white">{SITE.city}, Canada</span>
              </li>
            </ul>
          </div>
        </div>

        {/* --- Discovery ---------------------------------------------------- */}
        <div className="mt-12 grid gap-10 border-t border-white/10 pt-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <FooterColumn
            title="Explore tutors by subject"
            links={FOOTER_SUBJECT_LINKS}
            exploreHref="/find-a-tutor"
            className="sm:columns-2 lg:columns-3"
          />
          <FooterColumn
            title="Online classes"
            links={FOOTER_ONLINE_LINKS}
            exploreHref="/find-a-tutor?mode=ONLINE"
            className="sm:columns-2"
          />
        </div>

        {/* --- Useful links, app, newsletter --------------------------------- */}
        <div className="mt-12 grid gap-10 border-t border-white/10 pt-12 md:grid-cols-2 lg:grid-cols-3 lg:gap-16">
          <FooterColumn
            title="Useful links"
            links={FOOTER_USEFUL_LINKS}
            className="columns-2"
          />

          <div>
            <h2 className="text-base font-bold text-white">Get the mobile app</h2>
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Lessons, messages and reminders on the go. The APlus Learn app lands on iOS and
              Android soon — everything works in your mobile browser today.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <StoreBadge mark={<PlayStoreMark />} top="Coming soon on" name="Google Play" />
              <StoreBadge mark={<AppleMark />} top="Coming soon on" name="App Store" />
            </div>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">Sign up for our newsletter</h2>
            <p className="mt-4 text-sm leading-relaxed text-white/60">
              Course guides, exam-season study tips and new tutors in your area. Tick the
              newsletter box when you create your free account — unsubscribe any time.
            </p>
            {/* No subscribe endpoint exists; this hands the address to the real
                signup form, which carries the marketing opt-in. */}
            <form action="/register" method="get" className="mt-5 flex gap-2">
              <label htmlFor="footer-newsletter-email" className="sr-only">
                Email address
              </label>
              <input
                id="footer-newsletter-email"
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="Enter your email"
                className="h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-4 text-sm text-white outline-none transition-colors placeholder:text-white/40 hover:border-white/25 focus:border-white/40"
              />
              <button
                type="submit"
                className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-500 text-white transition-colors hover:bg-accent-600"
              >
                <Send className="size-5" aria-hidden="true" />
                <span className="sr-only">Continue to signup</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* --- Legal bar ------------------------------------------------------ */}
      <div className="bg-footer-deep">
        <div className="container-page flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-white/55">
            © {year} {SITE.name}. All rights reserved. Built in Canada 🇨🇦
          </p>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-sm text-white/70 transition-colors hover:text-white"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}

/**
 * A heading plus a dash-bulleted link list that flows down CSS columns, so the
 * reading order stays vertical exactly as the list is written.
 */
function FooterColumn({ title, links, exploreHref, className }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-base font-bold text-white">{title}</h2>
      <ul className={`mt-5 ${className}`}>
        {links.map((link) => (
          <FooterLink key={link.href} href={link.href} label={link.label} />
        ))}
        {exploreHref && (
          <li className="break-inside-avoid pb-3">
            <Link
              href={exploreHref}
              className="text-sm font-semibold text-brand-300 transition-colors hover:text-brand-200"
            >
              Explore all
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

function FooterLink({ href, label }) {
  return (
    <li className="break-inside-avoid pb-3">
      <Link
        href={href}
        className="group inline-flex items-start gap-2.5 text-sm text-white/60 transition-colors hover:text-white"
      >
        <span
          className="mt-[0.6em] h-px w-1.5 shrink-0 bg-white/30 transition-colors group-hover:bg-accent-400"
          aria-hidden="true"
        />
        {label}
      </Link>
    </li>
  );
}

function StoreBadge({ mark, top, name }) {
  return (
    <span className="inline-flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5">
      {mark}
      <span className="leading-tight">
        <span className="block text-[10px] uppercase tracking-wide text-white/50">{top}</span>
        <span className="block text-sm font-semibold text-white">{name}</span>
      </span>
    </span>
  );
}

/* Brand marks — lucide dropped its brand icons, so these are inline. */

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.25-1.5 1.55-1.5h1.65V3.62c-.29-.04-1.27-.12-2.42-.12-2.4 0-4.03 1.46-4.03 4.15V9.9H7.4V13h2.85v8h3.25Z" />
    </svg>
  );
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M17.53 3h3.05l-6.66 7.61L21.75 21h-6.13l-4.8-6.28L5.32 21H2.27l7.12-8.14L2.25 3h6.28l4.34 5.74L17.53 3Zm-1.07 16.17h1.69L7.62 4.73H5.8l10.66 14.44Z" />
    </svg>
  );
}

function LinkedInMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M6.94 8.43V20H3.6V8.43h3.34Zm.22-3.35c0 .96-.72 1.73-1.89 1.73h-.02C4.12 6.81 3.4 6.04 3.4 5.08c0-.98.74-1.73 1.9-1.73 1.15 0 1.85.75 1.86 1.73ZM20.6 13.37V20h-3.33v-6.25c0-1.49-.53-2.5-1.86-2.5-1.02 0-1.62.68-1.89 1.34-.1.24-.12.57-.12.9V20H10.1s.04-10.87 0-12h3.3v1.7c.44-.69 1.24-1.66 3.01-1.66 2.19 0 3.19 1.43 3.19 4.33Z" />
    </svg>
  );
}

function InstagramMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="5.2" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function YouTubeMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.27 5 12 5 12 5s-6.27 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.76 1.77C5.73 19 12 19 12 19s6.27 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15.02V8.98L15.2 12 10 15.02Z" />
    </svg>
  );
}

function PlayStoreMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
      <path fill="#00D2FF" d="M3.3 1.9c-.2.24-.3.6-.3 1.05v18.1c0 .45.1.81.3 1.05L13.6 12 3.3 1.9Z" />
      <path fill="#00F076" d="M17 8.35 4.9 1.4C4.3 1.05 3.76 1 3.3 1.9L13.6 12 17 8.35Z" />
      <path fill="#FFCE00" d="m20.7 10.6-3.7-2.25L13.6 12l3.4 3.65 3.7-2.25c1.06-.62 1.06-2.18 0-2.8Z" />
      <path fill="#FF3A44" d="M3.3 22.1c.46.9 1 .85 1.6.5L17 15.65 13.6 12 3.3 22.1Z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.53c-.02-2.4 1.96-3.55 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.89-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.61.02-3.1.94-3.93 2.38-1.68 2.9-.43 7.19 1.2 9.54.8 1.15 1.75 2.44 3 2.39 1.21-.05 1.66-.78 3.12-.78 1.46 0 1.87.78 3.14.75 1.3-.02 2.12-1.17 2.91-2.33.92-1.33 1.3-2.62 1.32-2.69-.03-.01-2.53-.97-2.55-3.8ZM14.65 4.9c.66-.8 1.11-1.92.99-3.03-.95.04-2.11.63-2.79 1.43-.61.7-1.15 1.84-1.01 2.92 1.07.08 2.15-.54 2.81-1.32Z" />
    </svg>
  );
}
