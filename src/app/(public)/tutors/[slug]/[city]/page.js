import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight, MapPin, Video, Users } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getCourseByCode, listProvinces } from "@/services/curriculum.service";
import { searchTutors } from "@/services/search.service";
import { CITY_CENTROIDS, SERVICE_CITIES } from "@/lib/geo";
import { deslugify } from "@/lib/utils/slug";
import { formatMoney } from "@/lib/utils/format";
import {
  Badge, Button, Card, CardBody, EmptyState, Reveal, RevealGroup, RevealItem,
} from "@/components/ui";
import { TutorCard } from "@/components/tutor/TutorCard";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { SITE } from "@/constants";

/**
 * Course + city landing page (§29).
 *
 * URL shape: /tutors/mhf4u/scarborough
 *
 * This is the long-tail counterpart to the curriculum page — the search a
 * parent actually types when they want someone who can come to them.
 */

export const revalidate = 3600;

function cityFromSlug(slug) {
  const key = String(slug).replace(/-/g, " ").toLowerCase();
  return CITY_CENTROIDS[key] ?? CITY_CENTROIDS[key.replace(/\s+/g, "")] ?? null;
}

export async function generateMetadata({ params }) {
  // The segment is named `slug` to match the sibling tutor-profile route;
  // here it always carries a course code.
  const { slug: code, city } = await params;
  await connectToDatabase();

  const course = await getCourseByCode(code);
  const location = cityFromSlug(city);

  if (!course || !location) return { title: "Not found" };

  return {
    title: `${course.code} tutors in ${location.city}`,
    description: `Find verified ${course.code} (${course.name}) tutors in ${location.city}, ${location.province}. Compare rates and reviews, then book online or in-person lessons.`,
    alternates: { canonical: `/tutors/${code.toLowerCase()}/${city}` },
  };
}

export default async function CourseCityPage({ params }) {
  const { slug: code, city } = await params;
  await connectToDatabase();

  const course = await getCourseByCode(code);
  const location = cityFromSlug(city);
  if (!course || !location) notFound();

  const provinces = await listProvinces({ activeOnly: true });
  const provinceSlug =
    provinces.find((p) => p.code === course.provinceCode)?.slug ?? "ontario";

  // In-person first (that's what the city qualifier implies), then online as a
  // fallback so the page is never empty in a thin market.
  const [inPerson, online] = await Promise.all([
    searchTutors({
      courseCode: course.code,
      province: course.provinceCode,
      city: location.city,
      mode: "IN_PERSON",
      distanceKm: 25,
      page: 1,
      pageSize: 6,
      sort: "DISTANCE",
    }),
    searchTutors({
      courseCode: course.code,
      province: course.provinceCode,
      mode: "ONLINE",
      page: 1,
      pageSize: 3,
      sort: "RELEVANCE",
    }),
  ]);

  const rates = inPerson.items.map((t) => t.displayRateCents ?? t.hourlyRateCents);
  const minRate = rates.length ? Math.min(...rates) : null;

  const cityFaqs = [
    {
      q: `Are there ${course.code} tutors near me in ${location.city}?`,
      a: inPerson.total
        ? `Yes — ${inPerson.total} ${inPerson.total === 1 ? "tutor teaches" : "tutors teach"} ${course.code} and travel within ${location.city}. Each profile shows roughly how far away they are, and you can filter by distance.`
        : `We don't have a ${course.code} tutor travelling to ${location.city} right now, but ${online.total} ${online.total === 1 ? "tutor teaches" : "tutors teach"} it online. You can also post a request and we'll notify you when a local tutor joins.`,
    },
    {
      q: `Where do in-person ${course.code} lessons take place?`,
      a: "Wherever you both agree — your home, a branch of the public library, or another public place. You choose when booking, and your address is only shared with the tutor once the lesson is confirmed.",
    },
    {
      q: `Is online cheaper than in person in ${location.city}?`,
      a: "Often slightly, since there's no travel time involved. Many tutors offer both and charge the same rate for each. You can compare directly in search.",
    },
  ];

  return (
    <>
      <PageHero
        eyebrow={`${location.city}, ${location.province}`}
        title={`${course.code} tutors in ${location.city}`}
        description={`${course.name} — find a verified tutor who can teach in person around ${location.city}, or online from anywhere in ${course.provinceCode}.`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button
            href={`/find-a-tutor?courseCode=${course.code}&city=${encodeURIComponent(location.city)}&province=${course.provinceCode}`}
            size="lg"
            iconRight={<ArrowRight className="size-4" />}
          >
            See all tutors
          </Button>
          {inPerson.total > 0 && (
            <Badge tone="success">
              {inPerson.total} available near {location.city}
            </Badge>
          )}
        </div>
      </PageHero>

      <Section tone="muted">
        <Reveal>
          <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink-900">
            <MapPin className="size-5 text-brand-600" />
            In person around {location.city}
          </h2>
        </Reveal>

        {inPerson.items.length === 0 ? (
          <EmptyState
            className="mt-6"
            icon={<MapPin className="size-7" />}
            title={`No ${course.code} tutors travelling to ${location.city} yet`}
            description="Online tutors teach the same course from anywhere in the province — or post a request and we'll notify you when a local tutor joins."
            action={
              <Button
                href={`/find-a-tutor?courseCode=${course.code}&mode=ONLINE&province=${course.provinceCode}`}
              >
                See online tutors
              </Button>
            }
            secondaryAction={
              <Button href="/requests/new" variant="secondary">
                Post a request
              </Button>
            }
          />
        ) : (
          <RevealGroup className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {inPerson.items.map((tutor) => (
              <RevealItem key={tutor.id}>
                <TutorCard tutor={tutor} courseCode={course.code} />
              </RevealItem>
            ))}
          </RevealGroup>
        )}
      </Section>

      {online.items.length > 0 && (
        <Section>
          <Reveal>
            <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink-900">
              <Video className="size-5 text-brand-600" />
              Online {course.code} tutors
            </h2>
            <p className="mt-2 text-sm text-ink-500">
              No travel time, and you&rsquo;re not limited to who happens to live nearby.
            </p>
          </Reveal>

          <RevealGroup className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {online.items.map((tutor) => (
              <RevealItem key={tutor.id}>
                <TutorCard tutor={tutor} courseCode={course.code} />
              </RevealItem>
            ))}
          </RevealGroup>
        </Section>
      )}

      <Section tone="muted">
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <Card className="h-full">
              <CardBody>
                <h3 className="text-sm font-bold text-ink-900">About {course.code}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">
                  {course.description ??
                    `${course.name} is a Grade ${course.gradeLevel} ${course.subjectName} course.`}
                </p>
                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-ink-100 pt-4 text-sm">
                  <div>
                    <dt className="text-xs text-ink-400">Grade</dt>
                    <dd className="font-semibold text-ink-800">Grade {course.gradeLevel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-400">Subject</dt>
                    <dd className="font-semibold text-ink-800">{course.subjectName}</dd>
                  </div>
                  {minRate && (
                    <div>
                      <dt className="text-xs text-ink-400">From</dt>
                      <dd className="font-semibold text-ink-800">
                        {formatMoney(minRate, { compact: true })}/hr
                      </dd>
                    </div>
                  )}
                </dl>
                <Button
                  href={`/${provinceSlug}/${course.gradeSlug}/${course.subjectSlug}/${course.code.toLowerCase()}`}
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  iconRight={<ArrowRight className="size-3.5" />}
                >
                  All {course.code} tutors
                </Button>
              </CardBody>
            </Card>
          </Reveal>

          <Reveal delay={0.08}>
            <Card className="h-full">
              <CardBody>
                <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
                  <Users className="size-4 text-ink-400" />
                  {course.code} in other cities
                </h3>
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {SERVICE_CITIES.filter(
                    (c) => c.province === course.provinceCode && c.city !== location.city,
                  )
                    .slice(0, 10)
                    .map((other) => (
                      <li key={other.city}>
                        <Link
                          href={`/tutors/${course.code.toLowerCase()}/${other.city.toLowerCase().replace(/\s+/g, "-")}`}
                          className="text-sm text-ink-600 hover:text-brand-600"
                        >
                          {other.city}
                        </Link>
                      </li>
                    ))}
                </ul>
              </CardBody>
            </Card>
          </Reveal>
        </div>
      </Section>

      <Faq
        faqs={cityFaqs}
        title={`${course.code} tutoring in ${location.city}`}
        showAllLink={false}
      />
    </>
  );
}
