import { Suspense } from "react";
import Link from "next/link";
import { SearchX, Sparkles } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { courseSearchSchema } from "@/lib/validation/search";
import {
  listCourses, courseFacets, listGrades, listSubjects, listProvinces,
} from "@/services/curriculum.service";
import { Button, EmptyState, Pagination, Skeleton } from "@/components/ui";
import { CourseCard } from "@/components/course/CourseCard";
import { CourseFilters } from "@/components/search/CourseFilters";
import { CourseToolbar } from "@/components/search/CourseToolbar";
import { RefineCourseSearch } from "@/components/search/RefineCourseSearch";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const subject = params.subject ? params.subject.replace(/-/g, " ") : "";
  const grade = params.grade ? params.grade.replace(/-/g, " ") : "";

  const what = [grade, subject].filter(Boolean).join(" ");
  const title = what ? `${what} courses` : "Browse courses";

  return {
    title,
    description: what
      ? `Every ${what} course APlus Learn covers. Filter by stream, grade and tutor availability, then find a tutor for the exact course on your child's timetable.`
      : "Every Ontario course APlus Learn covers, from Grade 1 numeracy to MCV4U. Filter by grade, subject, stream and tutor availability.",
    alternates: { canonical: "/courses" },
    // Filtered permutations shouldn't compete with the canonical course pages.
    robots: Object.keys(params).length > 2 ? { index: false, follow: true } : undefined,
  };
}

export default async function CoursesPage({ searchParams }) {
  const raw = await searchParams;

  // Invalid query strings fall back to defaults rather than erroring — a
  // pasted or truncated URL should still show results.
  const parsed = courseSearchSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : courseSearchSchema.parse({});

  return (
    <div className="bg-canvas pb-16">
      <CoursesHeader params={params} />
      <div className="container-wide">
        <Suspense fallback={<CoursesSkeleton />} key={JSON.stringify(raw)}>
          <CourseResults params={params} rawParams={raw} />
        </Suspense>
      </div>
    </div>
  );
}

async function CoursesHeader({ params }) {
  await connectToDatabase();
  const [provinces, grades, subjects] = await Promise.all([
    listProvinces({ activeOnly: false }),
    listGrades({ provinceCode: params.province ?? "ON" }),
    listSubjects(),
  ]);

  return (
    <div className="border-b border-ink-200 bg-white">
      <div className="container-wide py-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
          Browse courses
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Search by the code on the report card — an Ontario course code maps to exactly one set
          of curriculum expectations, so it&rsquo;s the most precise place to start.
        </p>
        <RefineCourseSearch
          className="mt-5"
          provinces={provinces}
          grades={grades}
          subjects={subjects}
        />
      </div>
    </div>
  );
}

async function CourseResults({ params, rawParams }) {
  await connectToDatabase();

  const province = params.province ?? "ON";
  const query = { ...params, province };

  const [result, facets, grades, subjects] = await Promise.all([
    listCourses({ ...query, pageSize: params.pageSize ?? 24 }),
    courseFacets(query),
    listGrades({ provinceCode: province }),
    listSubjects(),
  ]);

  // The card tints its plate from the course code, but falls back to the
  // subject's icon for elementary courses that have none.
  const iconBySubject = new Map(subjects.map((s) => [s.slug, s.icon]));
  const courses = result.items.map((course) => ({
    ...course,
    subjectIcon: iconBySubject.get(course.subjectSlug),
  }));

  const resolved = {
    grade: grades.find((g) => g.slug === params.grade) ?? null,
    subject: subjects.find((s) => s.slug === params.subject) ?? null,
  };

  const buildHref = (page) => {
    const next = new URLSearchParams(
      Object.entries(rawParams).filter(([, v]) => typeof v === "string"),
    );
    next.set("page", String(page));
    return `/courses?${next.toString()}`;
  };

  return (
    <div className="grid gap-8 py-8 lg:grid-cols-[17rem_1fr]">
      <CourseFilters facets={facets} grades={grades} subjects={subjects} />

      <div className="min-w-0">
        <CourseToolbar total={result.total} resolved={resolved} />

        {courses.length === 0 ? (
          <NoResults params={params} />
        ) : (
          <>
            <div className="mt-6 flex flex-col gap-4">
              {courses.map((course) => (
                <CourseCard key={course.id} course={course} layout="wide" />
              ))}
            </div>

            <Pagination
              className="mt-10"
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              pageSize={result.pageSize}
              label="courses"
              buildHref={buildHref}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Empty state that actually helps: it suggests which filter to relax rather
 * than only reporting that nothing matched (§32).
 */
function NoResults({ params }) {
  const suggestions = [];
  if (params.hasTutors) {
    suggestions.push({ label: "Include courses without tutors", href: relaxed(params, { hasTutors: "" }) });
  }
  if (params.stream?.length) {
    suggestions.push({ label: "Any stream", href: relaxed(params, { stream: "" }) });
  }
  if (params.stage?.length || params.minGrade !== undefined || params.maxGrade !== undefined) {
    suggestions.push({ label: "Any grade", href: relaxed(params, { stage: "", minGrade: "", maxGrade: "", grade: "" }) });
  }
  if (params.subject) {
    suggestions.push({ label: "All subjects", href: relaxed(params, { subject: "" }) });
  }
  if (params.hasCode !== undefined) {
    suggestions.push({ label: "Coded and uncoded courses", href: relaxed(params, { hasCode: "" }) });
  }
  if (params.q) {
    suggestions.push({ label: "Clear the search term", href: relaxed(params, { q: "" }) });
  }

  return (
    <EmptyState
      className="mt-6"
      icon={<SearchX className="size-7" />}
      title="No courses match all of those filters"
      description={
        suggestions.length
          ? "Try relaxing one of these, or tell us what you're looking for and we'll find a tutor for it."
          : "We don't have that course loaded yet. Post a request and we'll match you with a tutor who teaches it."
      }
      action={
        <div className="flex flex-col items-center gap-4">
          {suggestions.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.slice(0, 3).map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  className="rounded-full bg-brand-50 px-3.5 py-2 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 transition-colors hover:bg-brand-100"
                >
                  {s.label}
                </Link>
              ))}
            </div>
          )}
          <Button href="/requests/new" iconLeft={<Sparkles className="size-4" />}>
            Post a tutor request
          </Button>
        </div>
      }
    />
  );
}

function relaxed(params, changes) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value === undefined || value === null || value === "" || key === "page" || key === "pageSize") continue;
    next.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return `/courses?${next.toString()}`;
}

function CoursesSkeleton() {
  return (
    <div className="grid gap-8 py-8 lg:grid-cols-[17rem_1fr]">
      <div className="hidden lg:block">
        <div className="h-[36rem] rounded-2xl shimmer" />
      </div>
      <div className="min-w-0" role="status" aria-label="Loading courses">
        <div className="h-5 w-40 rounded shimmer" />
        <div className="mt-6 flex flex-col gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </div>
        <span className="sr-only">Loading courses…</span>
      </div>
    </div>
  );
}

/** Mirrors the wide card's plate-plus-text shape so the swap doesn't jump. */
function CourseCardSkeleton() {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Skeleton className="size-14 shrink-0 rounded-2xl sm:size-16" />
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-4 w-3/5" />
            </div>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    </div>
  );
}
