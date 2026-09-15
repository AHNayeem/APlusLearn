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

/** The policy set, with the operator's own name and support address (§26). */
async function legalPageFor(slug) {
  const { branding, contact } = await getAppConfig();
  return buildLegalPages({ appName: branding.appName, supportEmail: contact.supportEmail })[slug];
}

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
                  <a href={`mailto:${contact.supportEmail}`}>{contact.supportEmail}</a> and
                  we&rsquo;ll
                  explain it in plain language.
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
 * The policy copy uses **bold** for lead-ins. Escaping first means the content
 * itself can never inject markup — only our own <strong> wrapper survives.
 */
function markdownInline(text) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
