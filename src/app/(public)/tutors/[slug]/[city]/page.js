import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowRight, MapPin, Video } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getProvince } from "@/services/curriculum.service";
import {
  resolveTopicCity, topicSearchParams, citiesWithTutors, coursePath,
} from "@/services/landing.service";
import { searchTutors } from "@/services/search.service";
import { siteBaseUrl } from "@/lib/config/base-url";
import { formatMoney, formatNumber } from "@/lib/utils/format";
import { Badge, Button, Card, CardBody, Reveal } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, LandingHeading, TutorResults, CityLinks } from "@/components/seo/Landing";

/**
 * Topic + city landing page (§29, R32.2–R32.4, R32.6, R32.8).
 *
 * URL shape: /tutors/:topic/:city, where the topic is any of
 *
 *   /tutors/mhf4u/scarborough            a course code
 *   /tutors/mathematics/scarborough      a subject  (/tutors/math/… redirects here)
 *   /tutors/grade-12-mathematics/…       a grade + subject (grade-12-math redirects)
 *   /tutors/calculus/toronto             a course alias — redirects to the code
 *
 * Both segments are resolved from the database (`resolveTopicCity`); the
 * city decides the province, so "calculus" in Toronto and in Vancouver are
 * two different courses. A city search cannot locate is never swapped for a
 * nearby big one: it only resolves when a tutor gives it as their own city,
 * and then the page lists tutors by that exact city. Anything unresolvable
 * is a real 404.
 *
 * The tutor list is `searchTutors` with the same parameters the search page
 * would send, so this page and `/find-a-tutor` cannot disagree.
 */

export const revalidate = 3600;

const PAGE_SIZE = 9;

const load = cache(async (topic, city) => {
  await connectToDatabase();
  const hit = await resolveTopicCity({ topic, city });
  if (!hit) return null;

  const [nearby, province] = await Promise.all([
    searchTutors({ ...topicSearchParams(hit), page: 1, pageSize: PAGE_SIZE, sort: "RELEVANCE" }),
    getProvince(hit.topic.provinceCode),
  ]);
  return { ...hit, nearby, province };
});

/** "MHF4U", "Mathematics", "Grade 12 mathematics" — what the page is about. */
function topicLabel(topic) {
  if (topic.kind === "COURSE") return topic.course.code ?? topic.course.name;
  if (topic.kind === "GRADE_SUBJECT") return `${topic.grade.name} ${topic.subject.name.toLowerCase()}`;
  return topic.subject.name;
}

/** The topic's full name, for descriptions: "MHF4U (Advanced Functions)". */
function topicFullName(topic) {
  if (topic.kind === "COURSE" && topic.course.code) return `${topic.course.code} (${topic.course.name})`;
  return topicLabel(topic);
}

export async function generateMetadata({ params }) {
  const { slug, city } = await params;
  const hit = await load(slug, city);
  if (!hit) return { title: "Page not found", robots: { index: false, follow: false } };

  const label = topicLabel(hit.topic);
  const where = hit.province ? `${hit.city.name}, ${hit.province.name}` : hit.city.name;
  const title = `${label} tutors in ${hit.city.name}`;
  const description = `Find ${topicFullName(hit.topic)} tutors in ${where}. Compare rates and reviews, then book online or in-person lessons.`;

  return {
    title,
    description,
    alternates: { canonical: hit.canonicalPath },
    openGraph: { title, description },
    // A page with nobody on it is not worth a search result; it stays
    // reachable for the visitor who followed a link to it.
    ...(hit.nearby.total === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function TopicCityPage({ params }) {
  const { slug, city } = await params;
  const hit = await load(slug, city);
  if (!hit) notFound();
  if (!hit.canonical) permanentRedirect(hit.canonicalPath);

  const { topic, city: place, nearby, province } = hit;
  // A city search cannot locate is only a page because tutors list it as
  // theirs; if none of them teach this topic, there is nothing to show.
  if (!place.coordinates && nearby.total === 0) notFound();

  const label = topicLabel(topic);
  const lower = topic.kind === "COURSE" ? label : label.toLowerCase();
  const courseCode = topic.kind === "COURSE" ? topic.course.code : undefined;

  const [online, otherCities, baseUrl] = await Promise.all([
    searchTutors({
      ...topicSearchParams(hit, { mode: "ONLINE", withCity: false }),
      page: 1,
      pageSize: 3,
      sort: "RELEVANCE",
    }),
    citiesWithTutors({
      provinceCode: topic.provinceCode,
      courseId: topic.kind === "COURSE" ? topic.course.id : undefined,
      subjectSlug: topic.kind === "COURSE" ? undefined : topic.subject.slug,
      gradeLevel: topic.kind === "GRADE_SUBJECT" ? topic.grade.level : undefined,
      limit: 13,
    }),
    siteBaseUrl(),
  ]);

  // Online tutors already listed above are not listed twice.
  const shown = new Set(nearby.items.map((t) => t.id));
  const onlineOnly = online.items.filter((t) => !shown.has(t.id));

  const query = new URLSearchParams(topicSearchParams(hit));
  query.delete("mode");
  const searchHref = `/find-a-tutor?${query.toString()}`;

  const rates = nearby.items.map((t) => t.displayRateCents ?? t.hourlyRateCents).filter(Boolean);
  const minRate = rates.length ? Math.min(...rates) : null;

  const upPath =
    topic.kind === "COURSE" && province
      ? coursePath(province.slug, topic.course)
      : topic.kind === "GRADE_SUBJECT" && province
        ? `/${province.slug}/${topic.grade.slug}/${topic.subject.slug}`
        : province
          ? `/${province.slug}/${topic.subject.slug}`
          : null;

  const faqs = [
    {
      q: `Are there ${lower} tutors near me in ${place.name}?`,
      a: nearby.total
        ? `Yes — ${formatNumber(nearby.total)} ${nearby.total === 1 ? "tutor teaches" : "tutors teach"} ${lower} ${place.coordinates ? `in or around ${place.name}` : `and list ${place.name} as their city`}. ${place.coordinates ? "Each profile shows roughly how far away they are." : ""}`.trim()
        : `No ${lower} tutor lists ${place.name} yet${online.total ? `, but ${formatNumber(online.total)} ${online.total === 1 ? "tutor teaches" : "tutors teach"} it online` : ""}. You can also post a request so tutors who join can respond.`,
    },
    {
      q: `Where do in-person ${lower} lessons take place?`,
      a: "Wherever you both agree — your home, a public library, or another public place. You choose when booking, and your address is only shared with the tutor once the lesson is confirmed.",
    },
    {
      q: `Can ${lower} lessons be online instead?`,
      a: "Yes, with any tutor who offers online lessons. A meeting link is generated when you book, and many tutors offer both formats.",
    },
  ];

  return (
    <>
      <Breadcrumbs
        baseUrl={baseUrl}
        items={[
          { label: "Home", href: "/" },
          ...(province ? [{ label: province.name, href: `/${province.slug}` }] : []),
          ...(upPath ? [{ label: `${label} tutors`, href: upPath }] : []),
          { label: place.name, href: hit.canonicalPath },
        ]}
      />

      <PageHero
        eyebrow={province ? `${place.name}, ${province.name}` : place.name}
        title={`${label} tutors in ${place.name}`}
        description={
          topic.kind === "COURSE"
            ? `${topic.course.name} — tutors who teach it around ${place.name}, in person or online.`
            : `${label} tutors around ${place.name}, in person or online${province ? `, for the ${province.name} curriculum` : ""}.`
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={searchHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            Search these tutors
          </Button>
          {nearby.total > 0 && (
            <Badge tone="success">
              {formatNumber(nearby.total)} {nearby.total === 1 ? "tutor" : "tutors"} in {place.name}
            </Badge>
          )}
        </div>
      </PageHero>

      <Section tone="muted" align="start">
        <LandingHeading
          title={
            <span className="flex items-center gap-2">
              <MapPin className="size-5 text-brand-600" aria-hidden="true" />
              {label} tutors in {place.name}
            </span>
          }
          description={
            place.coordinates
              ? "Tutors who teach in person nearby and tutors based here who teach online — the same results search gives for this city."
              : `Tutors who list ${place.name} as their city — the same results search gives for it.`
          }
        />
        <TutorResults
          results={nearby}
          courseCode={courseCode}
          searchHref={searchHref}
          emptyTitle={`No ${lower} tutors in ${place.name} yet`}
          emptyDescription="Online tutors teach from anywhere in the province — or post a request and tutors who join can respond."
        />
      </Section>

      {onlineOnly.length > 0 && (
        <Section align="start">
          <LandingHeading
            title={
              <span className="flex items-center gap-2">
                <Video className="size-5 text-brand-600" aria-hidden="true" />
                Online {lower} tutors{province ? ` across ${province.name}` : ""}
              </span>
            }
            description="No travel time, and you're not limited to who happens to live nearby."
          />
          <TutorResults results={{ items: onlineOnly, total: onlineOnly.length }} courseCode={courseCode} searchHref={searchHref} />
        </Section>
      )}

      <Section tone="muted" align="start">
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <Card className="h-full">
              <CardBody>
                <h3 className="text-sm font-bold text-ink-900">About {label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  {topic.kind === "COURSE"
                    ? (topic.course.description ??
                      `${topic.course.name} is a Grade ${topic.course.gradeLevel} ${topic.course.subjectName} course.`)
                    : (topic.subject.description ?? `${label} tutoring for the ${province?.name ?? "provincial"} curriculum.`)}
                </p>
                {minRate && (
                  <p className="mt-3 text-sm text-ink-600">
                    Rates here start from{" "}
                    <strong className="text-ink-900">{formatMoney(minRate, { compact: true })}/hr</strong>.
                  </p>
                )}
                {upPath && (
                  <Button href={upPath} variant="secondary" size="sm" className="mt-4" iconRight={<ArrowRight className="size-3.5" />}>
                    All {label} tutors{province ? ` in ${province.name}` : ""}
                  </Button>
                )}
              </CardBody>
            </Card>
          </Reveal>

          {otherCities.some((c) => c.slug !== place.slug) && (
            <Reveal delay={0.08}>
              <Card className="h-full">
                <CardBody>
                  <CityLinks
                    title={`${label} in other cities`}
                    columns="sm:grid-cols-2"
                    cities={otherCities.filter((c) => c.slug !== place.slug).slice(0, 12)}
                    hrefFor={(other) => `/tutors/${topic.slug}/${other.slug}`}
                  />
                </CardBody>
              </Card>
            </Reveal>
          )}
        </div>
      </Section>

      <Faq faqs={faqs} title={`${label} tutoring in ${place.name}`} showAllLink={false} />

      {/* What this page lists, for search engines (R32.8). */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${label} tutors in ${place.name}`,
          url: `${baseUrl}${hit.canonicalPath}`,
          numberOfItems: nearby.items.length,
          itemListElement: nearby.items.map((tutor, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: `${baseUrl}/tutors/${tutor.slug}`,
            name: tutor.displayName,
          })),
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((faq) => ({
            "@type": "Question",
            name: faq.q,
            acceptedAnswer: { "@type": "Answer", text: faq.a },
          })),
        }}
      />
    </>
  );
}
