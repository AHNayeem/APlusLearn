import Link from "next/link";
import * as Icons from "lucide-react";
import { Search, BookOpen, ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import {
  listCourses, listGrades, listSubjects, listProvinces,
} from "@/services/curriculum.service";
import { courseSearchSchema } from "@/lib/validation/search";
import {
  Badge, Button, Card, CardBody, EmptyState, Pagination, Reveal, RevealGroup, RevealItem,
} from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import { cn } from "@/lib/utils/cn";

export const metadata = {
  title: "Browse courses",
  description:
    "Every Ontario course APlus Learn covers, from Grade 1 numeracy to MCV4U. Find a tutor for the exact course on your child's timetable.",
  alternates: { canonical: "/courses" },
};

export const dynamic = "force-dynamic";

export default async function CoursesPage({ searchParams }) {
  await connectToDatabase();

  const raw = await searchParams;
  const parsed = courseSearchSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : courseSearchSchema.parse({});

  const [result, grades, subjects, provinces] = await Promise.all([
    listCourses({ ...params, province: params.province ?? "ON", pageSize: 36 }),
    listGrades({ provinceCode: params.province ?? "ON" }),
    listSubjects(),
    listProvinces({ activeOnly: false }),
  ]);

  const buildHref = (overrides) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...params, ...overrides })) {
      if (!value || key === "pageSize") continue;
      next.set(key, String(value));
    }
    return `/courses?${next.toString()}`;
  };

  return (
    <>
      <PageHero
        eyebrow="Courses"
        title="Search by the code on the report card"
        description="Ontario course codes map to exactly one set of curriculum expectations. Start there and you'll find tutors who have actually taught it."
      >
        <form action="/courses" className="flex max-w-lg gap-2">
          <input type="hidden" name="province" value={params.province ?? "ON"} />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
            <label className="sr-only" htmlFor="course-search">
              Search courses
            </label>
            <input
              id="course-search"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="MHF4U, Advanced Functions, Grade 9 math…"
              className="h-11 w-full rounded-xl border-0 bg-white pl-9 pr-3 text-sm shadow-xs ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
          </div>
          <Button type="submit" size="md" className="h-11">
            Search
          </Button>
        </form>
      </PageHero>

      <Section tone="muted">
        <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
          <Reveal>
            <aside aria-label="Course filters" className="space-y-6 lg:sticky lg:top-24">
              <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-900">
                  Grade
                </h2>
                <ul className="space-y-1">
                  <li>
                    <Link
                      href={buildHref({ grade: "", page: "" })}
                      className={cn(
                        "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                        !params.grade
                          ? "bg-brand-50 font-semibold text-brand-700"
                          : "text-ink-600 hover:bg-ink-100",
                      )}
                    >
                      All grades
                    </Link>
                  </li>
                  {grades.map((grade) => (
                    <li key={grade.id}>
                      <Link
                        href={buildHref({ grade: grade.slug, page: "" })}
                        className={cn(
                          "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                          params.grade === grade.slug
                            ? "bg-brand-50 font-semibold text-brand-700"
                            : "text-ink-600 hover:bg-ink-100",
                        )}
                      >
                        {grade.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-900">
                  Subject
                </h2>
                <ul className="space-y-1">
                  <li>
                    <Link
                      href={buildHref({ subject: "", page: "" })}
                      className={cn(
                        "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                        !params.subject
                          ? "bg-brand-50 font-semibold text-brand-700"
                          : "text-ink-600 hover:bg-ink-100",
                      )}
                    >
                      All subjects
                    </Link>
                  </li>
                  {subjects.map((subject) => (
                    <li key={subject.id}>
                      <Link
                        href={buildHref({ subject: subject.slug, page: "" })}
                        className={cn(
                          "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                          params.subject === subject.slug
                            ? "bg-brand-50 font-semibold text-brand-700"
                            : "text-ink-600 hover:bg-ink-100",
                        )}
                      >
                        {subject.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </Reveal>

          <div className="min-w-0">
            <p className="mb-5 text-sm text-ink-500">
              <span className="font-bold text-ink-900">{result.total}</span>{" "}
              {result.total === 1 ? "course" : "courses"}
              {params.q && (
                <>
                  {" "}matching <span className="font-semibold text-ink-900">“{params.q}”</span>
                </>
              )}
            </p>

            {result.items.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="size-7" />}
                title="No courses match"
                description="Try a different search, or browse by grade and subject."
                action={<Button href="/courses">Clear filters</Button>}
              />
            ) : (
              <RevealGroup className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {result.items.map((course) => (
                  <RevealItem key={course.id}>
                    <CourseCard course={course} />
                  </RevealItem>
                ))}
              </RevealGroup>
            )}

            <Pagination
              className="mt-8"
              page={result.page}
              totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))}
              total={result.total}
              pageSize={result.pageSize}
              label="courses"
              buildHref={(p) => buildHref({ page: p })}
            />
          </div>
        </div>
      </Section>
    </>
  );
}

function CourseCard({ course }) {
  const href = course.code
    ? `/find-a-tutor?courseCode=${course.code}&province=${course.provinceCode}`
    : `/find-a-tutor?course=${course.slug}&grade=${course.gradeSlug}&province=${course.provinceCode}`;

  return (
    <Link
      href={href}
      className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-canvas p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-[10px] font-black text-white">
          {course.code ?? "ON"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-ink-900 group-hover:text-brand-700">
            {course.name}
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Grade {course.gradeLevel} · {course.subjectName}
            {course.stream ? ` · ${course.stream}` : ""}
          </p>
        </div>
      </div>

      {course.description && (
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-ink-500">
          {course.description}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        {course.tutorCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-700">
            <span className="size-1.5 rounded-full bg-success-500" />
            {course.tutorCount} {course.tutorCount === 1 ? "tutor" : "tutors"}
          </span>
        ) : (
          <span className="text-xs text-ink-400">No tutors yet</span>
        )}
        <span className="text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
          Find tutors →
        </span>
      </div>
    </Link>
  );
}
