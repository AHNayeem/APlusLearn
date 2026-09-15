import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, BookOpen, MapPin, Users } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getCourseByPath, getProvince, listProvinces } from "@/services/curriculum.service";
import { searchTutors, marketplaceStats } from "@/services/search.service";
import { Course } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { deslugify } from "@/lib/utils/slug";
import { formatMoney, formatNumber } from "@/lib/utils/format";
import { Badge, Button, Card, CardBody, EmptyState, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { TutorCard } from "@/components/tutor/TutorCard";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { SERVICE_CITIES } from "@/lib/geo";
import { getAppConfig } from "@/services/settings.service";

/**
 * Curriculum landing page (§29).
 *
 * URL shape: /ontario/grade-12/math/mhf4u
 *
 * These are the pages that should rank for "MHF4U tutor" — one page per
 * course, server-rendered with real tutors and course-specific copy.
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

export async function generateMetadata({ params }) {
  const { province, grade, subject, course } = await params;
  await connectToDatabase();

  const provinceDoc = await getProvince(province);
  const courseDoc = await getCourseByPath({
    province: provinceDoc?.code,
    grade,
    subject,
    course,
  });

  if (!courseDoc) return { title: "Course not found" };

  const label = courseDoc.code ? `${courseDoc.code} (${courseDoc.name})` : courseDoc.name;

  return {
    title: `${label} tutors in ${provinceDoc.name}`,
    description: `Find verified ${label} tutors in ${provinceDoc.name}. Compare rates, reviews and availability, then book online or in-person lessons. ${courseDoc.description ?? ""}`.slice(0, 300),
    alternates: { canonical: `/${province}/${grade}/${subject}/${course}` },
    openGraph: {
      title: `${label} tutors in ${provinceDoc.name}`,
      description: courseDoc.description,
    },
  };
}

export default async function CourseLandingPage({ params }) {
  const { province, grade, subject, course } = await params;
  await connectToDatabase();

  const provinceDoc = await getProvince(province);
  if (!provinceDoc) notFound();

  const courseDoc = await getCourseByPath({
    province: provinceDoc.code,
    grade,
    subject,
    course,
  });
  if (!courseDoc) notFound();

  const [results, related, stats] = await Promise.all([
    searchTutors({
      courseCode: courseDoc.code ?? undefined,
      course: courseDoc.code ? undefined : courseDoc.slug,
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
    marketplaceStats(),
  ]);

  const { branding } = await getAppConfig();

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
      a: rates.length
        ? `${label} tutors on ${branding.appName} charge between ${formatMoney(minRate, { compact: true })} and ${formatMoney(maxRate, { compact: true })} an hour. Certified teachers and specialists sit at the higher end. The rate on a profile is exactly what you pay — there are no booking fees.`
        : `Rates vary by tutor and qualification. Most Ontario tutors charge between $45 and $85 an hour, and the rate on a profile is exactly what you pay.`,
    },
    {
      q: `Are ${label} tutors verified?`,
      a: "Every tutor's identity is checked before their profile appears in search. Many also hold badges for education, Ontario College of Teachers membership, current university enrolment or a background check — each one verified separately by our team.",
    },
    {
      q: `Can I get ${label} help online?`,
      a: "Yes. Most tutors offer online lessons over Zoom, Google Meet or Microsoft Teams, and a meeting link is generated automatically when you book. You can also filter for tutors who'll come to you in person.",
    },
    {
      q: `How quickly can I book a ${label} lesson?`,
      a: "Tutors publish their real availability, so you book a slot that's genuinely free. Many have openings within a few days, and some take bookings with as little as a few hours' notice.",
    },
  ];

  return (
    <>
      <PageHero
        eyebrow={`${provinceDoc.name} · ${deslugify(grade)}`}
        title={`${label} tutors`}
        description={
          courseDoc.description ??
          `Find a verified tutor for ${courseDoc.name} in ${provinceDoc.name}.`
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
                Ranked by verified reviews and completed lessons — not by who paid for placement.
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

              {courseDoc.code && (
                <Card>
                  <CardBody>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
                      <MapPin className="size-4 text-ink-400" />
                      {courseDoc.code} by city
                    </h3>
                    <ul className="mt-3 space-y-1">
                      {SERVICE_CITIES.filter((c) => c.province === provinceDoc.code)
                        .slice(0, 8)
                        .map((city) => (
                          <li key={city.city}>
                            <Link
                              href={`/tutors/${courseDoc.code.toLowerCase()}/${city.city.toLowerCase().replace(/\s+/g, "-")}`}
                              className="text-sm text-ink-600 hover:text-brand-600"
                            >
                              {courseDoc.code} tutors in {city.city}
                            </Link>
                          </li>
                        ))}
                    </ul>
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
                  href={`/${province}/${item.gradeSlug}/${item.subjectSlug}/${item.code ? item.code.toLowerCase() : item.slug}`}
                  className="group flex items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md motion-reduce:hover:translate-y-0"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[10px] font-black text-brand-700">
                    {item.code ?? "ON"}
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

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Course",
            name: courseDoc.code ? `${courseDoc.code} — ${courseDoc.name}` : courseDoc.name,
            description: courseDoc.description,
            provider: { "@type": "Organization", name: branding.appName },
            educationalLevel: `Grade ${courseDoc.gradeLevel}`,
            ...(courseDoc.code && { courseCode: courseDoc.code }),
          }),
        }}
      />
    </>
  );
}
