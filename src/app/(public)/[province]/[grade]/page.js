import { cache } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import {
  resolveProvinceSection, subjectsWithCourses, gradesWithCourses, landingCourses, citiesWithTutors,
  coursePath,
} from "@/services/landing.service";
import { searchTutors } from "@/services/search.service";
import { hourlyRateRange } from "@/services/public-content.service";
import { siteBaseUrl } from "@/lib/config/base-url";
import { formatMoney, formatNumber } from "@/lib/utils/format";
import { Badge, Button } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import {
  Breadcrumbs, LandingHeading, CourseLinks, ChipLinks, TutorResults, CityLinks,
} from "@/components/seo/Landing";

/**
 * The level under a province (R32.5): either a subject — `/ontario/math`,
 * the "Ontario math tutor" page — or a grade, `/ontario/grade-12`.
 *
 * The folder is named `[grade]` because the course route below it already
 * is; which of the two a segment means is decided from the database by
 * `resolveProvinceSection`. Aliases and codes permanently redirect to the
 * canonical slugs, and a segment that is neither — or a subject the province
 * has no live course in — is a 404.
 */

const load = cache(async (province, section) => {
  await connectToDatabase();
  return resolveProvinceSection({ province, section });
});

function titleFor(hit) {
  return hit.kind === "SUBJECT"
    ? `${hit.subject.name} tutors in ${hit.province.name}`
    : `${hit.grade.name} tutors in ${hit.province.name}`;
}

export async function generateMetadata({ params }) {
  const { province, grade: section } = await params;
  const hit = await load(province, section);
  if (!hit) return { title: "Page not found", robots: { index: false, follow: false } };

  const description =
    hit.kind === "SUBJECT"
      ? `${hit.subject.name} tutoring for every grade of the ${hit.province.name} curriculum. Compare tutors by course, rate and reviews, then book online or in person.`
      : `${hit.grade.name} tutors in ${hit.province.name}, by subject and course. Compare rates and reviews, then book online or in person.`;

  return {
    title: titleFor(hit),
    description,
    alternates: { canonical: hit.canonicalPath },
    openGraph: { title: titleFor(hit), description },
  };
}

export default async function ProvinceSectionPage({ params }) {
  const { province, grade: section } = await params;
  const hit = await load(province, section);
  if (!hit) notFound();
  if (!hit.canonical) permanentRedirect(hit.canonicalPath);

  return hit.kind === "SUBJECT" ? <SubjectInProvince hit={hit} /> : <GradeInProvince hit={hit} />;
}

async function SubjectInProvince({ hit }) {
  const { province, subject } = hit;

  const [courses, grades, tutors, cities, rateRange, baseUrl] = await Promise.all([
    landingCourses({ provinceCode: province.code, subjectId: subject.id }),
    gradesWithCourses({ provinceId: province.id, subjectId: subject.id }),
    searchTutors({ province: province.code, subject: subject.slug, page: 1, pageSize: 6, sort: "RELEVANCE" }),
    citiesWithTutors({ provinceCode: province.code, subjectSlug: subject.slug }),
    hourlyRateRange({ provinceCode: province.code, subjectSlug: subject.slug }).catch(() => null),
    siteBaseUrl(),
  ]);

  const searchHref = `/find-a-tutor?province=${province.code}&subject=${subject.slug}`;
  const alsoKnownAs = (subject.aliases ?? []).filter((alias) => !alias.includes("-"));

  return (
    <>
      <Breadcrumbs
        baseUrl={baseUrl}
        items={[
          { label: "Home", href: "/" },
          { label: province.name, href: `/${province.slug}` },
          { label: subject.name, href: `/${province.slug}/${subject.slug}` },
        ]}
      />

      <PageHero
        eyebrow={`${province.name} · ${subject.name}`}
        title={`${subject.name} tutors in ${province.name}`}
        description={
          subject.description ??
          `${subject.name} help for every grade of the ${province.name} curriculum, from tutors who list the exact courses they teach.`
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={searchHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            Search {subject.name.toLowerCase()} tutors
          </Button>
          {tutors.total > 0 && (
            <Badge tone="success">
              {formatNumber(tutors.total)} {tutors.total === 1 ? "tutor" : "tutors"} available
            </Badge>
          )}
        </div>
        {alsoKnownAs.length > 0 && (
          <p className="mt-4 text-xs text-ink-400">Also searched as: {alsoKnownAs.join(", ")}</p>
        )}
      </PageHero>

      <Section tone="muted" align="start">
        <LandingHeading
          title={`${subject.name} courses in ${province.name}`}
          description={`${formatNumber(courses.length)} ${courses.length === 1 ? "course" : "courses"} across ${formatNumber(grades.length)} ${grades.length === 1 ? "grade" : "grades"}.`}
        />
        <ChipLinks
          label={`${subject.name} by grade`}
          items={grades.map((grade) => ({
            href: `/${province.slug}/${grade.slug}/${subject.slug}`,
            label: `${grade.name} ${subject.name.toLowerCase()}`,
          }))}
        />
        <div className="mt-8">
          <CourseLinks courses={courses} provinceCode={province.code} hrefFor={(course) => coursePath(province.slug, course)} />
        </div>
      </Section>

      <Section align="start">
        <LandingHeading
          title={`${subject.name} tutors`}
          description={
            rateRange
              ? `Half of ${province.name} ${subject.name.toLowerCase()} tutors charge between ${formatMoney(rateRange.lowCents, { compact: true })} and ${formatMoney(rateRange.highCents, { compact: true })} an hour. The rate on a profile is the rate you pay.`
              : "Each tutor sets their own rate, shown on their profile. The rate on a profile is the rate you pay."
          }
        />
        <TutorResults
          results={tutors}
          searchHref={searchHref}
          emptyTitle={`No ${subject.name.toLowerCase()} tutors in ${province.name} yet`}
          emptyDescription="Post a request and tutors who join for this subject can respond to it."
        />
        {cities.length > 0 && (
          <div className="mt-10">
            <CityLinks
              title={`${subject.name} tutors by city`}
              cities={cities}
              hrefFor={(city) => `/tutors/${subject.slug}/${city.slug}`}
            />
          </div>
        )}
      </Section>
    </>
  );
}

async function GradeInProvince({ hit }) {
  const { province, grade } = hit;

  const [subjects, courses, tutors, cities, baseUrl] = await Promise.all([
    subjectsWithCourses({ provinceCode: province.code, gradeId: grade.id }),
    landingCourses({ provinceCode: province.code, gradeId: grade.id }),
    searchTutors({ province: province.code, grade: grade.slug, page: 1, pageSize: 6, sort: "RELEVANCE" }),
    citiesWithTutors({ provinceCode: province.code, gradeLevel: grade.level }),
    siteBaseUrl(),
  ]);

  const searchHref = `/find-a-tutor?province=${province.code}&grade=${grade.slug}`;

  return (
    <>
      <Breadcrumbs
        baseUrl={baseUrl}
        items={[
          { label: "Home", href: "/" },
          { label: province.name, href: `/${province.slug}` },
          { label: grade.name, href: `/${province.slug}/${grade.slug}` },
        ]}
      />

      <PageHero
        eyebrow={`${province.name} · ${grade.name}`}
        title={`${grade.name} tutors in ${province.name}`}
        description={`Every ${grade.name} subject and course in the ${province.name} curriculum, and the tutors who teach them.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button href={searchHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            Search {grade.name} tutors
          </Button>
          {tutors.total > 0 && (
            <Badge tone="success">
              {formatNumber(tutors.total)} {tutors.total === 1 ? "tutor" : "tutors"} available
            </Badge>
          )}
        </div>
      </PageHero>

      <Section tone="muted" align="start">
        <LandingHeading title={`${grade.name} subjects`} />
        <ChipLinks
          label={`${grade.name} subjects`}
          items={subjects.map((subject) => ({
            href: `/${province.slug}/${grade.slug}/${subject.slug}`,
            label: subject.name,
            count: subject.courseCount,
          }))}
        />
        <div className="mt-8">
          <CourseLinks courses={courses} provinceCode={province.code} hrefFor={(course) => coursePath(province.slug, course)} />
        </div>
      </Section>

      <Section align="start">
        <LandingHeading title={`${grade.name} tutors`} />
        <TutorResults
          results={tutors}
          searchHref={searchHref}
          emptyTitle={`No ${grade.name} tutors in ${province.name} yet`}
          emptyDescription="Post a request and tutors who join for this grade can respond to it."
        />
        {cities.length > 0 && (
          <div className="mt-10">
            <CityLinks
              title={`${grade.name} tutors by city`}
              cities={cities}
              hrefFor={(city) => `/find-a-tutor?province=${province.code}&grade=${grade.slug}&city=${encodeURIComponent(city.name)}`}
            />
          </div>
        )}
      </Section>
    </>
  );
}
