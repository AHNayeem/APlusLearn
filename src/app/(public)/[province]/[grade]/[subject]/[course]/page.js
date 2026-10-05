import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { listProvinces } from "@/services/curriculum.service";
import { resolveCoursePath, citiesWithTutors, coursePath } from "@/services/landing.service";
import { searchTutors } from "@/services/search.service";
import { hourlyRateRange } from "@/services/public-content.service";
import { Course } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { formatMoney } from "@/lib/utils/format";
import { Badge, Button, Card, CardBody, EmptyState, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { TutorCard } from "@/components/tutor/TutorCard";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { getAppConfig } from "@/services/settings.service";
import { siteBaseUrl } from "@/lib/config/base-url";
import { JsonLd } from "@/components/seo/JsonLd";
import { Breadcrumbs, CityLinks } from "@/components/seo/Landing";

/**
 * Curriculum landing page (§29, R32.7).
 *
 * URL shape: /ontario/grade-12/mathematics/mhf4u
 *
 * These are the pages that should rank for "MHF4U tutor" — one page per
 * course, server-rendered with real tutors and course-specific copy.
 *
 * Every segment is resolved from the database (`resolveCoursePath`): a
 * province by slug, alias or code, a grade and subject by slug or alias, the
 * course by slug, alias or course code. So the spec's own
 * `/ontario/grade-12/math/mhf4u` reaches the course whose subject slug is
 * `mathematics`, and answers with a permanent redirect to the canonical
 * spelling rather than a duplicate page. A path whose parts do not belong
 * together, or that names anything inactive, is a real 404.
 */

export const revalidate = 3600;

/** Prerender the popular courses; the rest render on demand. */
export async function generateStaticParams() {
  await connectToDatabase();
  const courses = await Course.find({ isActive: true, isPopular: true })
    .limit(30)
    .select("slug code gradeSlug subjectSlug provinceCode")
    .lean();

  const provinces = await listProvinces({ activeOnly: true });
  const provinceSlug = new Map(provinces.map((p) => [p.code, p.slug]));

  return courses
    .filter((c) => provinceSlug.has(c.provinceCode))
    .map((course) => ({
      province: provinceSlug.get(course.provinceCode),
      grade: course.gradeSlug,
      subject: course.subjectSlug,
      course: course.code ? course.code.toLowerCase() : course.slug,
    }));
}

const load = cache(async (province, grade, subject, course) => {
  await connectToDatabase();
  return resolveCoursePath({ province, grade, subject, course });
});

export async function generateMetadata({ params }) {
  const { province, grade, subject, course } = await params;
  const hit = await load(province, grade, subject, course);
  if (!hit) return { title: "Course not found", robots: { index: false, follow: false } };

  const { province: provinceDoc, course: courseDoc } = hit;
  const label = courseDoc.code ? `${courseDoc.code} (${courseDoc.name})` : courseDoc.name;

  return {
    title: `${label} tutors in ${provinceDoc.name}`,
    description: `Find ${label} tutors in ${provinceDoc.name}. Compare rates, reviews and availability, then book online or in-person lessons. ${courseDoc.description ?? ""}`.slice(0, 300),
    alternates: { canonical: hit.canonicalPath },
    openGraph: {
      title: `${label} tutors in ${provinceDoc.name}`,
      description: courseDoc.description,
    },
  };
}

export default async function CourseLandingPage({ params }) {
  const { province, grade, subject, course } = await params;
  const hit = await load(province, grade, subject, course);
  if (!hit) notFound();
  if (!hit.canonical) permanentRedirect(hit.canonicalPath);

  const { province: provinceDoc, grade: gradeDoc, subject: subjectDoc, course: courseDoc } = hit;

  const [results, related, cities, rateRange, { branding, policy }, baseUrl] = await Promise.all([
    searchTutors({
      courseCode: courseDoc.code ?? undefined,
      course: courseDoc.code ? undefined : courseDoc.slug,
      grade: courseDoc.code ? undefined : courseDoc.gradeSlug,
      province: provinceDoc.code,
      page: 1,
      pageSize: 6,
      sort: "RELEVANCE",
    }),
    Course.find({
      _id: { $ne: courseDoc.id },
      isActive: true,
      provinceCode: provinceDoc.code,
      $or: [{ subjectSlug: courseDoc.subjectSlug }, { gradeSlug: courseDoc.gradeSlug }],
    })
      .sort({ isPopular: -1, tutorCount: -1 })
      .limit(6)
      .lean(),
    citiesWithTutors({ provinceCode: provinceDoc.code, courseId: courseDoc.id, limit: 8 }),
    hourlyRateRange({ provinceCode: provinceDoc.code, courseId: courseDoc.id }).catch(() => null),
    getAppConfig(),
    siteBaseUrl(),
  ]);

  const label = courseDoc.code ? `${courseDoc.code}` : courseDoc.name;
  const searchHref = courseDoc.code
    ? `/find-a-tutor?courseCode=${courseDoc.code}&province=${provinceDoc.code}`
    : `/find-a-tutor?course=${courseDoc.slug}&grade=${courseDoc.gradeSlug}&province=${provinceDoc.code}`;

  const rates = results.items.map((t) => t.displayRateCents ?? t.hourlyRateCents);
  const minRate = rates.length ? Math.min(...rates) : null;
  const maxRate = rates.length ? Math.max(...rates) : null;

  const courseFaqs = [
    {
      q: `How much does a ${label} tutor cost?`,
      a: rateRange
        ? `Half of the ${label} tutors on ${branding.appName} charge between ${formatMoney(rateRange.lowCents, { compact: true })} and ${formatMoney(rateRange.highCents, { compact: true })} an hour. The rate on a profile is exactly what you pay — there are no booking fees.`
        : rates.length
          ? `The ${label} tutors listed here charge between ${formatMoney(minRate, { compact: true })} and ${formatMoney(maxRate, { compact: true })} an hour. The rate on a profile is exactly what you pay — there are no booking fees.`
          : "Each tutor sets their own rate, and it is shown on their profile. The rate on a profile is exactly what you pay — there are no booking fees.",
    },
    {
      q: `Are ${label} tutors verified?`,
      a: `Every tutor is reviewed by our team before their profile appears in search. Badges — identity, education, teaching certification, university enrolment, background check — are each granted separately, only after the matching document was reviewed, and a profile shows exactly which ones a tutor holds. A badge confirms a document; it is not a guarantee of teaching quality or safety.`,
    },
    {
      q: `Can I get ${label} help online?`,
      a: "Yes. Many tutors teach online, and a meeting link is generated when you book. You can also filter for tutors who teach in person.",
    },
    {
      q: `How quickly can I book a ${label} lesson?`,
      a: `Tutors publish their availability, so you book a slot that is free. Lessons can be booked from ${policy.minimumBookingNoticeHours} ${policy.minimumBookingNoticeHours === 1 ? "hour" : "hours"} ahead up to ${policy.bookingHorizonDays} days in advance.`,
    },
  ];

  return (
    <>
      <Breadcrumbs
        baseUrl={baseUrl}
        items={[
          { label: "Home", href: "/" },
          { label: provinceDoc.name, href: `/${provinceDoc.slug}` },
          { label: gradeDoc.name, href: `/${provinceDoc.slug}/${gradeDoc.slug}` },
          { label: subjectDoc.name, href: `/${provinceDoc.slug}/${gradeDoc.slug}/${subjectDoc.slug}` },
          { label, href: hit.canonicalPath },
        ]}
      />

      <PageHero
        eyebrow={`${provinceDoc.name} · ${gradeDoc.name}`}
        title={`${label} tutors`}
        description={
          courseDoc.description ??
          `Find a tutor for ${courseDoc.name} in ${provinceDoc.name}.`
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={searchHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            See all {label} tutors
          </Button>
          {results.total > 0 && (
            <Badge tone="success">
              {results.total} {results.total === 1 ? "tutor" : "tutors"} available
            </Badge>
          )}
        </div>
      </PageHero>

      <Section tone="muted">
        <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
          <div className="min-w-0">
            <Reveal>
              <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
                Top {label} tutors
              </h2>
              <p className="mt-2 text-sm text-ink-500">
                Ordered the way search orders them: reviews and completed lessons first. Promoted profiles are labelled.
              </p>
            </Reveal>

            {results.items.length === 0 ? (
              <EmptyState
                className="mt-6"
                icon={<BookOpen className="size-7" />}
                title={`No ${label} tutors yet`}
                description="Post a request and we'll notify you as soon as a matching tutor joins."
                action={<Button href="/requests/new">Post a tutor request</Button>}
                secondaryAction={
                  <Button href="/find-a-tutor" variant="secondary">
                    Browse all tutors
                  </Button>
                }
              />
            ) : (
              <>
                <RevealGroup className="mt-6 grid gap-5 sm:grid-cols-2">
                  {results.items.map((tutor) => (
                    <RevealItem key={tutor.id}>
                      <TutorCard tutor={tutor} courseCode={courseDoc.code} />
                    </RevealItem>
                  ))}
                </RevealGroup>

                <Reveal className="mt-8">
                  <Button
                    href={searchHref}
                    variant="secondary"
                    size="lg"
                    iconRight={<ArrowRight className="size-4" />}
                  >
                    See all {results.total} {label} tutors
                  </Button>
                </Reveal>
              </>
            )}
          </div>

          <Reveal delay={0.1}>
            <div className="space-y-6 lg:sticky lg:top-24">
              <Card>
                <CardBody>
                  <h3 className="text-sm font-bold text-ink-900">About this course</h3>
                  <dl className="mt-4 space-y-3 text-sm">
                    {courseDoc.code && (
                      <div>
                        <dt className="text-xs text-ink-400">Course code</dt>
                        <dd className="font-bold text-ink-900">{courseDoc.code}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-xs text-ink-400">Full name</dt>
                      <dd className="font-medium text-ink-800">{courseDoc.name}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-400">Grade</dt>
                      <dd className="font-medium text-ink-800">Grade {courseDoc.gradeLevel}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-ink-400">Subject</dt>
                      <dd className="font-medium text-ink-800">{courseDoc.subjectName}</dd>
                    </div>
                    {courseDoc.stream && (
                      <div>
                        <dt className="text-xs text-ink-400">Pathway</dt>
                        <dd className="font-medium text-ink-800">{courseDoc.stream}</dd>
                      </div>
                    )}
                    {courseDoc.credits && (
                      <div>
                        <dt className="text-xs text-ink-400">Credits</dt>
                        <dd className="font-medium text-ink-800">{courseDoc.credits}</dd>
                      </div>
                    )}
                    {minRate && (
                      <div className="border-t border-ink-100 pt-3">
                        <dt className="text-xs text-ink-400">Typical rate</dt>
                        <dd className="font-bold text-ink-900">
                          {formatMoney(minRate, { compact: true })}–
                          {formatMoney(maxRate, { compact: true })}/hr
                        </dd>
                      </div>
                    )}
                  </dl>
                </CardBody>
              </Card>

              {cities.length > 0 && (
                <Card>
                  <CardBody>
                    <CityLinks
                      title={`${label} by city`}
                      cities={cities}
                      columns=""
                      hrefFor={(city) => `/tutors/${courseDoc.code ? courseDoc.code.toLowerCase() : courseDoc.slug}/${city.slug}`}
                    />
                  </CardBody>
                </Card>
              )}
            </div>
          </Reveal>
        </div>
      </Section>

      {related.length > 0 && (
        <Section eyebrow="Related" title="Other courses families book alongside this">
          <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {toPlain(related).map((item) => (
              <RevealItem key={item.id}>
                <Link
                  href={coursePath(provinceDoc.slug, item)}
                  className="group flex items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md motion-reduce:hover:translate-y-0"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[10px] font-black text-brand-700">
                    {item.code ?? item.provinceCode}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-ink-900 group-hover:text-brand-700">
                      {item.name}
                    </span>
                    <span className="block text-xs text-ink-500">
                      Grade {item.gradeLevel} · {item.tutorCount ?? 0} tutors
                    </span>
                  </span>
                </Link>
              </RevealItem>
            ))}
          </RevealGroup>
        </Section>
      )}

      <Faq faqs={courseFaqs} title={`${label} tutoring questions`} showAllLink={false} />

      <JsonLd
        data={{
            "@context": "https://schema.org",
            "@type": "Course",
            name: courseDoc.code ? `${courseDoc.code} — ${courseDoc.name}` : courseDoc.name,
            description: courseDoc.description,
            provider: { "@type": "Organization", name: branding.appName },
            educationalLevel: `Grade ${courseDoc.gradeLevel}`,
            ...(courseDoc.code && { courseCode: courseDoc.code }),
          }}
      />
    </>
  );
}
