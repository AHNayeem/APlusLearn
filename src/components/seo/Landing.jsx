import Link from "next/link";
import { ArrowRight, ChevronRight, MapPin } from "lucide-react";
import { RevealGroup, RevealItem, Reveal, Button, EmptyState } from "@/components/ui";
import { TutorCard } from "@/components/tutor/TutorCard";
import { formatNumber } from "@/lib/utils/format";
import { JsonLd } from "./JsonLd";

/**
 * Building blocks for the curriculum landing pages (§32).
 *
 * Province, province + subject, grade + subject, course and topic + city
 * pages are the same family: a trail back up the curriculum, links down to
 * the next level, and the tutors search would show. Every link these render
 * is built by the page from stored records, so a link here never points at a
 * page that would 404.
 */

/**
 * Visible trail plus its `BreadcrumbList` (§32). `baseUrl` makes the
 * structured-data items absolute, which is what search engines expect.
 */
export function Breadcrumbs({ items, baseUrl }) {
  if (!items?.length) return null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="border-b border-ink-100 bg-white">
        <ol className="container-page flex flex-wrap items-center gap-1 py-3 text-xs text-ink-500">
          {items.map((item, index) => {
            const last = index === items.length - 1;
            return (
              <li key={item.href} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3 text-ink-300" aria-hidden="true" />}
                {last ? (
                  <span aria-current="page" className="font-semibold text-ink-700">
                    {item.label}
                  </span>
                ) : (
                  <Link href={item.href} className="hover:text-brand-600">
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: items.map((item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.label,
            item: `${baseUrl}${item.href}`,
          })),
        }}
      />
    </>
  );
}

/** A heading row for a landing section, with an optional link on the right. */
export function LandingHeading({ title, description, action }) {
  return (
    <Reveal className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">{title}</h2>
        {description && <p className="mt-2 text-sm leading-relaxed text-ink-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </Reveal>
  );
}

/** Course cards, each linking to its canonical course page. */
export function CourseLinks({ courses, hrefFor, provinceCode }) {
  if (!courses?.length) return null;

  return (
    <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <RevealItem key={course.id}>
          <Link
            href={hrefFor(course)}
            className="group flex h-full items-start gap-3 rounded-2xl border border-ink-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md motion-reduce:hover:translate-y-0"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 px-1 text-center text-[10px] font-black leading-tight text-brand-700">
              {course.code ?? provinceCode ?? course.provinceCode}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-ink-900 group-hover:text-brand-700">
                {course.name}
              </span>
              <span className="mt-0.5 block text-xs text-ink-500">
                Grade {course.gradeLevel}
                {course.stream ? ` · ${course.stream}` : ""}
                {course.tutorCount > 0
                  ? ` · ${formatNumber(course.tutorCount)} ${course.tutorCount === 1 ? "tutor" : "tutors"}`
                  : ""}
              </span>
            </span>
          </Link>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/** Chips — grades or subjects — that lead one level down the curriculum. */
export function ChipLinks({ items, label }) {
  if (!items?.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
          >
            {item.label}
            {item.count != null && (
              <span className="text-xs font-medium text-ink-400">{formatNumber(item.count)}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The tutors search would show for this page, with the way into search
 * itself. An empty list is said plainly, with somewhere useful to go.
 */
export function TutorResults({ results, courseCode, searchHref, emptyTitle, emptyDescription }) {
  const items = results?.items ?? [];

  if (!items.length) {
    return (
      <EmptyState
        icon={<MapPin className="size-7" />}
        title={emptyTitle}
        description={emptyDescription}
        action={<Button href="/requests/new">Post a tutor request</Button>}
        secondaryAction={
          <Button href={searchHref} variant="secondary">
            Search all tutors
          </Button>
        }
      />
    );
  }

  return (
    <>
      <RevealGroup className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((tutor) => (
          <RevealItem key={tutor.id}>
            <TutorCard tutor={tutor} courseCode={courseCode} />
          </RevealItem>
        ))}
      </RevealGroup>
      {results.total > items.length && (
        <Reveal className="mt-8">
          <Button href={searchHref} variant="secondary" size="lg" iconRight={<ArrowRight className="size-4" />}>
            See all {formatNumber(results.total)} tutors
          </Button>
        </Reveal>
      )}
    </>
  );
}

/** Links to topic + city pages, from the cities tutors actually list. */
export function CityLinks({ cities, hrefFor, title, columns = "sm:grid-cols-2 lg:grid-cols-3" }) {
  if (!cities?.length) return null;
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
        <MapPin className="size-4 text-ink-400" aria-hidden="true" />
        {title}
      </h3>
      <ul className={`mt-3 grid gap-1 ${columns}`}>
        {cities.map((city) => (
          <li key={city.slug}>
            <Link href={hrefFor(city)} className="text-sm text-ink-600 hover:text-brand-600">
              {city.name}
              <span className="text-xs text-ink-400"> · {formatNumber(city.tutorCount)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
