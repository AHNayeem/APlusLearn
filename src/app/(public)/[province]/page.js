import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import {
  resolveProvince, subjectsWithCourses, gradesWithCourses, citiesWithTutors, provinceTutorCount,
  coursePath,
} from "@/services/landing.service";
import { popularCourses } from "@/services/curriculum.service";
import { searchTutors } from "@/services/search.service";
import { siteBaseUrl } from "@/lib/config/base-url";
import { formatNumber } from "@/lib/utils/format";
import { Badge, Button } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import {
  Breadcrumbs, LandingHeading, CourseLinks, ChipLinks, TutorResults, CityLinks,
} from "@/components/seo/Landing";

/**
 * Province landing page — "Ontario math tutor", one level up (R32.5).
 *
 * URL shape: /ontario. The segment is resolved from the database: a live
 * province's slug renders, its code or an alias (`/on`) permanently
 * redirects to the slug, and anything else — including every unmatched
 * top-level path, since this segment catches them all — is a real 404.
 */

const load = cache(async (segment) => {
  await connectToDatabase();
  return resolveProvince(segment);
});

export async function generateMetadata({ params }) {
  const { province: segment } = await params;
  const hit = await load(segment);
  if (!hit) return { title: "Page not found", robots: { index: false, follow: false } };

  const { province } = hit;
  return {
    title: `Tutors in ${province.name} — by grade, subject and course`,
    description: `Find tutors for the ${province.name} curriculum. Browse by grade, subject or course${province.usesCourseCodes ? " code" : ""}, compare rates and reviews, and book online or in-person lessons.`,
    alternates: { canonical: `/${province.slug}` },
  };
}

export default async function ProvinceLandingPage({ params }) {
  const { province: segment } = await params;
  const hit = await load(segment);
  if (!hit) notFound();
  if (!hit.canonical) permanentRedirect(`/${hit.province.slug}`);

  const { province } = hit;
  const [subjects, grades, popular, tutors, cities, tutorCount, baseUrl] = await Promise.all([
    subjectsWithCourses({ provinceCode: province.code }),
    gradesWithCourses({ provinceId: province.id }),
    popularCourses(6, province.code),
    searchTutors({ province: province.code, page: 1, pageSize: 6, sort: "RELEVANCE" }),
    citiesWithTutors({ provinceCode: province.code }),
    provinceTutorCount(province.code),
    siteBaseUrl(),
  ]);

  // A live province with no live course has nothing to land on.
  if (!subjects.length) notFound();

  const searchHref = `/find-a-tutor?province=${province.code}`;

  return (
    <>
      <Breadcrumbs
        baseUrl={baseUrl}
        items={[
          { label: "Home", href: "/" },
          { label: province.name, href: `/${province.slug}` },
        ]}
      />

      <PageHero
        eyebrow={province.name}
        title={`Tutors in ${province.name}`}
        description={`Tutoring matched to the ${province.name} curriculum — pick a subject, a grade${province.usesCourseCodes ? " or the course code on the report card" : " or a course"}, and see the tutors who teach it.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={searchHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            Search {province.name} tutors
          </Button>
          {tutorCount > 0 && (
            <Badge tone="success">
              {formatNumber(tutorCount)} {tutorCount === 1 ? "tutor" : "tutors"} teaching here
            </Badge>
          )}
        </div>
      </PageHero>

      <Section tone="muted" align="start">
        <LandingHeading
          title={`Subjects in ${province.name}`}
          description="Each subject page lists its courses across every grade, and the tutors who teach them."
        />
        <ChipLinks
          label={`Subjects in ${province.name}`}
          items={subjects.map((subject) => ({
            href: `/${province.slug}/${subject.slug}`,
            label: subject.name,
            count: subject.courseCount,
          }))}
        />

        {grades.length > 0 && (
          <div className="mt-10">
            <LandingHeading title="Browse by grade" />
            <ChipLinks
              label={`Grades in ${province.name}`}
              items={grades.map((grade) => ({ href: `/${province.slug}/${grade.slug}`, label: grade.name }))}
            />
          </div>
        )}
      </Section>

      {popular.length > 0 && (
        <Section align="start">
          <LandingHeading
            title={`Popular ${province.name} courses`}
            action={
              <Button href={`/courses?province=${province.code}`} variant="secondary" iconRight={<ArrowRight className="size-4" />}>
                All {province.name} courses
              </Button>
            }
          />
          <CourseLinks courses={popular} provinceCode={province.code} hrefFor={(course) => coursePath(province.slug, course)} />
        </Section>
      )}

      <Section tone="muted" align="start">
        <LandingHeading
          title={`Tutors teaching in ${province.name}`}
          description="Ordered the way search orders them: reviews and completed lessons first. Promoted profiles are labelled."
        />
        <TutorResults
          results={tutors}
          searchHref={searchHref}
          emptyTitle={`No tutors in ${province.name} yet`}
          emptyDescription="Post a request and tutors who join for your course can respond to it."
        />
        {cities.length > 0 && (
          <div className="mt-10">
            <CityLinks
              title={`Where ${province.name} tutors are`}
              cities={cities}
              hrefFor={(city) => `/find-a-tutor?province=${province.code}&city=${encodeURIComponent(city.name)}`}
            />
          </div>
        )}
      </Section>
    </>
  );
}
