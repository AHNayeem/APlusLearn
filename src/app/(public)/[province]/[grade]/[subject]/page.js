import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import {
  resolveGradeSubject, landingCourses, citiesWithTutors, coursePath,
} from "@/services/landing.service";
import { searchTutors } from "@/services/search.service";
import { hourlyRateRange } from "@/services/public-content.service";
import { siteBaseUrl } from "@/lib/config/base-url";
import { formatMoney, formatNumber } from "@/lib/utils/format";
import { Badge, Button } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import {
  Breadcrumbs, LandingHeading, CourseLinks, TutorResults, CityLinks,
} from "@/components/seo/Landing";

/**
 * Grade + subject landing page — "Grade 12 math tutor" (R32.3, R32.5).
 *
 * URL shape: /ontario/grade-12/mathematics. `/ontario/grade-12/math`
 * permanently redirects there; a grade and subject with no live course
 * together is a 404.
 */

const load = cache(async (province, grade, subject) => {
  await connectToDatabase();
  return resolveGradeSubject({ province, grade, subject });
});

function titleFor({ province, grade, subject }) {
  return `${grade.name} ${subject.name} tutors in ${province.name}`;
}

export async function generateMetadata({ params }) {
  const { province, grade, subject } = await params;
  const hit = await load(province, grade, subject);
  if (!hit) return { title: "Page not found", robots: { index: false, follow: false } };

  const description = `${hit.grade.name} ${hit.subject.name.toLowerCase()} tutoring for the ${hit.province.name} curriculum: every course, the tutors who teach it, their rates and reviews.`;
  return {
    title: titleFor(hit),
    description,
    alternates: { canonical: hit.canonicalPath },
    openGraph: { title: titleFor(hit), description },
  };
}

export default async function GradeSubjectPage({ params }) {
  const { province: p, grade: g, subject: s } = await params;
  const hit = await load(p, g, s);
  if (!hit) notFound();
  if (!hit.canonical) permanentRedirect(hit.canonicalPath);

  const { province, grade, subject } = hit;
  const [courses, tutors, cities, rateRange, baseUrl] = await Promise.all([
    landingCourses({ provinceCode: province.code, gradeId: grade.id, subjectId: subject.id }),
    searchTutors({
      province: province.code,
      grade: grade.slug,
      subject: subject.slug,
      page: 1,
      pageSize: 6,
      sort: "RELEVANCE",
    }),
    citiesWithTutors({ provinceCode: province.code, subjectSlug: subject.slug, gradeLevel: grade.level }),
    hourlyRateRange({
      provinceCode: province.code,
      subjectSlug: subject.slug,
      minGradeLevel: grade.level,
      maxGradeLevel: grade.level,
    }).catch(() => null),
    siteBaseUrl(),
  ]);

  const searchHref = `/find-a-tutor?province=${province.code}&grade=${grade.slug}&subject=${subject.slug}`;
  const title = titleFor(hit);

  return (
    <>
      <Breadcrumbs
        baseUrl={baseUrl}
        items={[
          { label: "Home", href: "/" },
          { label: province.name, href: `/${province.slug}` },
          { label: grade.name, href: `/${province.slug}/${grade.slug}` },
          { label: subject.name, href: hit.canonicalPath },
        ]}
      />

      <PageHero
        eyebrow={`${province.name} · ${grade.name}`}
        title={title}
        description={`${grade.name} ${subject.name.toLowerCase()} in ${province.name} covers ${formatNumber(courses.length)} ${courses.length === 1 ? "course" : "courses"}. Pick the one on the timetable, or browse the tutors who teach at this level.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={searchHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            Search {grade.name} {subject.name.toLowerCase()} tutors
          </Button>
          {tutors.total > 0 && (
            <Badge tone="success">
              {formatNumber(tutors.total)} {tutors.total === 1 ? "tutor" : "tutors"} available
            </Badge>
          )}
        </div>
      </PageHero>

      <Section tone="muted" align="start">
        <LandingHeading title={`${grade.name} ${subject.name.toLowerCase()} courses`} />
        <CourseLinks courses={courses} provinceCode={province.code} hrefFor={(course) => coursePath(province.slug, course)} />
      </Section>

      <Section align="start">
        <LandingHeading
          title={`${grade.name} ${subject.name.toLowerCase()} tutors`}
          description={
            rateRange
              ? `Half of these tutors charge between ${formatMoney(rateRange.lowCents, { compact: true })} and ${formatMoney(rateRange.highCents, { compact: true })} an hour.`
              : "Each tutor sets their own rate, shown on their profile."
          }
        />
        <TutorResults
          results={tutors}
          searchHref={searchHref}
          emptyTitle={`No ${grade.name} ${subject.name.toLowerCase()} tutors yet`}
          emptyDescription="Post a request and tutors who join for this grade and subject can respond to it."
        />
        {cities.length > 0 && (
          <div className="mt-10">
            <CityLinks
              title={`${grade.name} ${subject.name.toLowerCase()} tutors by city`}
              cities={cities}
              hrefFor={(city) => `/tutors/${grade.slug}-${subject.slug}/${city.slug}`}
            />
          </div>
        )}
      </Section>
    </>
  );
}
