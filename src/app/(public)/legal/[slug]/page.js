import { notFound } from "next/navigation";
import Link from "next/link";
import { buildLegalPages, LEGAL_SLUGS, FOOTER_NAV } from "@/constants";
import { getAppConfig } from "@/services/settings.service";
import { Reveal } from "@/components/ui";
import { PageHero, Prose } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";

/** Legal pages are static content — prerender all of them at build time (§43). */
export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

/**
 * The policy set, built from the operator's own identity and the live policy
 * numbers (§26, §33) — the same Settings document the booking engine applies,
 * so the page never describes a rule the platform does not enforce.
 */
async function legalPageFor(slug) {
  const { branding, contact, policy } = await getAppConfig();
  if (!Object.hasOwn(LEGAL_PAGES_BY_SLUG, slug)) return null;
  return buildLegalPages({
    appName: branding.appName,
    supportEmail: contact.supportEmail,
    contact,
    policy,
  })[slug];
}

/** Membership check without building anything — and immune to `__proto__`-style slugs. */
const LEGAL_PAGES_BY_SLUG = Object.fromEntries(LEGAL_SLUGS.map((slug) => [slug, true]));

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const page = await legalPageFor(slug);
  if (!page) return { title: "Not found" };

  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/legal/${slug}` },
  };
}

export default async function LegalPage({ params }) {
  const { slug } = await params;
  const [page, { contact }] = await Promise.all([legalPageFor(slug), getAppConfig()]);
  if (!page) notFound();

  const otherPages = FOOTER_NAV.find((g) => g.title === "Legal")?.links ?? [];

  return (
    <>
      <PageHero eyebrow="Legal" title={page.title} description={page.description} />

      <Section tone="muted">
        <div className="grid gap-10 lg:grid-cols-[1fr_15rem]">
          <Reveal className="min-w-0">
            <p className="mb-8 text-xs text-ink-400">Last updated {page.lastUpdated}</p>

            <Prose>
              {page.sections.map((section) => (
                <section key={section.heading}>
                  <h2>{section.heading}</h2>
                  {section.body.map((paragraph, i) => (
                    <p key={i} dangerouslySetInnerHTML={{ __html: markdownInline(paragraph) }} />
                  ))}
                </section>
              ))}

              <section>
                <h2>Questions</h2>
                <p>
                  If anything here is unclear, email{" "}
                  <a href={`mailto:${contact.supportEmail}`}>{contact.supportEmail}</a>
                  {contact.supportPhone ? (
                    <>
                      {" "}or call <a href={`tel:${contact.supportPhone}`}>{contact.supportPhone}</a>
                    </>
                  ) : null}{" "}
                  and we&rsquo;ll explain it in plain language. The{" "}
                  <Link href="/help-centre">help centre</Link> answers the most common questions.
                </p>
              </section>
            </Prose>
          </Reveal>

          <Reveal delay={0.1}>
            <nav aria-label="Legal pages" className="lg:sticky lg:top-24">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                Legal &amp; policies
              </p>
              <ul className="mt-3 space-y-2">
                {otherPages.map((link) => {
                  const active = link.href === `/legal/${slug}`;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={active ? "page" : undefined}
                        className={
                          active
                            ? "text-sm font-semibold text-brand-700"
                            : "text-sm text-ink-600 hover:text-brand-600"
                        }
                      >
                        {link.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </Reveal>
        </div>
      </Section>
    </>
  );
}

/**
 * The policy copy uses **bold** for lead-ins and [label](/path) for links to
 * other pages on this site. Escaping first means the content itself can never
 * inject markup — only our own <strong> and <a> wrappers survive, and a link
 * target must be a same-site path made of plain path characters, so nothing
 * substituted from settings can become a `javascript:` or off-site href.
 */
function markdownInline(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((\/(?![/\\])[a-z0-9\-/#]*)\)/gi, '<a href="$2">$1</a>');
}
