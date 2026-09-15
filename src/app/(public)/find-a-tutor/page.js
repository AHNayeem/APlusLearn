import { Suspense } from "react";
import Link from "next/link";
import { SearchX, Sparkles } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { tutorSearchSchema } from "@/lib/validation/search";
import { searchTutors, searchFacets } from "@/services/search.service";
import { listProvinces, listGrades, listSubjects } from "@/services/curriculum.service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { Button, EmptyState, Pagination, SkeletonCard } from "@/components/ui";
import { TutorCard } from "@/components/tutor/TutorCard";
import { SearchFilters } from "@/components/search/SearchFilters";
import { SearchToolbar } from "@/components/search/SearchToolbar";
import { RefineSearch } from "@/components/search/RefineSearch";

export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const code = params.courseCode?.toUpperCase();
  const subject = params.subject;
  const city = params.city;

  const what = code ?? (subject ? subject.replace(/-/g, " ") : "");
  const where = city ? ` in ${city}` : "";
  const title = what
    ? `${what} tutors${where}`
    : `Find a tutor${where}`;

  return {
    title,
    description: what
      ? `Compare verified ${what} tutors${where}. See rates, reviews, verification badges and real availability, then book online or in person.`
      : "Search verified Canadian tutors by province, grade, subject and course code. Compare rates and reviews, then book online or in person.",
    alternates: { canonical: "/find-a-tutor" },
    // Filtered permutations shouldn't compete with the canonical course pages.
    robots: Object.keys(params).length > 2 ? { index: false, follow: true } : undefined,
  };
}

export default async function FindATutorPage({ searchParams }) {
  const raw = await searchParams;

  // Invalid query strings fall back to defaults rather than erroring — a
  // pasted or truncated URL should still show results.
  const parsed = tutorSearchSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : tutorSearchSchema.parse({});

  return (
    <div className="bg-canvas pb-16">
      <SearchHeader params={params} />
      <div className="container-page">
        <Suspense fallback={<SearchSkeleton />} key={JSON.stringify(raw)}>
          <SearchResults params={params} rawParams={raw} />
        </Suspense>
      </div>
    </div>
  );
}

async function SearchHeader({ params }) {
  await connectToDatabase();
  const [provinces, grades, subjects] = await Promise.all([
    listProvinces({ activeOnly: false }),
    listGrades({ provinceCode: params.province ?? "ON" }),
    listSubjects(),
  ]);

  return (
    <div className="border-b border-ink-200 bg-white">
      <div className="container-page py-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
          Find a tutor
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Search by course code, subject or grade — then filter by what matters to you.
        </p>
        <RefineSearch
          className="mt-5"
          provinces={provinces}
          grades={grades}
          subjects={subjects}
        />
      </div>
    </div>
  );
}

async function SearchResults({ params, rawParams }) {
  await connectToDatabase();
  const user = await getCurrentUser();

  const [result, facets] = await Promise.all([
    searchTutors(params, { viewerId: user?.id }),
    searchFacets(params),
  ]);

  const buildHref = (page) => {
    const next = new URLSearchParams(
      Object.entries(rawParams).filter(([, v]) => typeof v === "string"),
    );
    next.set("page", String(page));
    return `/find-a-tutor?${next.toString()}`;
  };

  return (
    <div className="grid gap-8 py-8 lg:grid-cols-[17rem_1fr]">
      <SearchFilters facets={facets} resolved={result.resolved} />

      <div className="min-w-0">
        <SearchToolbar total={result.total} resolved={result.resolved} />

        {result.items.length === 0 ? (
          <NoResults params={params} />
        ) : (
          <>
            <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {result.items.map((tutor) => (
                <TutorCard
                  key={tutor.id}
                  tutor={tutor}
                  courseCode={result.resolved.course?.code}
                />
              ))}
            </div>

            <Pagination
              className="mt-10"
              page={result.page}
              totalPages={result.totalPages}
              total={result.total}
              pageSize={result.pageSize}
              label="tutors"
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
  if (params.distanceKm || params.city || params.postalCode) {
    suggestions.push({ label: "Include online tutors", href: buildRelaxed(params, { mode: "ONLINE", city: "", postalCode: "", distanceKm: "" }) });
  }
  if (params.maxPrice) {
    suggestions.push({ label: "Remove the price limit", href: buildRelaxed(params, { minPrice: "", maxPrice: "" }) });
  }
  if (params.verified?.length) {
    suggestions.push({ label: "Remove verification filters", href: buildRelaxed(params, { verified: "" }) });
  }
  if (params.minRating) {
    suggestions.push({ label: "Include all ratings", href: buildRelaxed(params, { minRating: "" }) });
  }
  if (params.availability?.length) {
    suggestions.push({ label: "Any availability", href: buildRelaxed(params, { availability: "" }) });
  }

  return (
    <EmptyState
      className="mt-6"
      icon={<SearchX className="size-7" />}
      title="No tutors match all of those filters"
      description={
        suggestions.length
          ? "Try relaxing one of these, or post a request and let tutors come to you."
          : "We don't have a tutor for that combination yet. Post a request and we'll notify matching tutors as they join."
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

function buildRelaxed(params, changes) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (value === undefined || value === null || value === "" || key === "page" || key === "pageSize") continue;
    next.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return `/find-a-tutor?${next.toString()}`;
}

function SearchSkeleton() {
  return (
    <div className="grid gap-8 py-8 lg:grid-cols-[17rem_1fr]">
      <div className="hidden lg:block">
        <div className="h-[36rem] rounded-2xl shimmer" />
      </div>
      <div className="min-w-0" role="status" aria-label="Loading tutors">
        <div className="h-5 w-40 rounded shimmer" />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <span className="sr-only">Loading tutors…</span>
      </div>
    </div>
  );
}
