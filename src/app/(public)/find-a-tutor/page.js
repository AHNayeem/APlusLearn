import { Suspense } from "react";
import Link from "next/link";
import { after } from "next/server";
import { headers } from "next/headers";
import { SearchX, Sparkles, MapPinOff, Info } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { tutorSearchSchema } from "@/lib/validation/search";
import { searchTutors, searchFacets } from "@/services/search.service";
import { recordSearch } from "@/services/search-analytics.service";
import {
  listProvinces, listGrades, listSubjects, defaultProvinceCode,
} from "@/services/curriculum.service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { Button, EmptyState, Pagination, Skeleton } from "@/components/ui";
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
      <div className="container-wide">
        <Suspense fallback={<SearchSkeleton />} key={JSON.stringify(raw)}>
          <SearchResults params={params} rawParams={raw} />
        </Suspense>
      </div>
    </div>
  );
}

async function SearchHeader({ params }) {
  await connectToDatabase();
  // The picker starts on the searched province, else the first live one in
  // the administrator's order — read from the data, never a literal (§6).
  const province = params.province ?? (await defaultProvinceCode());
  const [provinces, grades, subjects] = await Promise.all([
    listProvinces({ activeOnly: false }),
    province ? listGrades({ provinceCode: province }) : [],
    province ? listSubjects({ provinceCode: province }) : listSubjects(),
  ]);

  return (
    <div className="border-b border-ink-200 bg-white">
      <div className="container-wide py-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
          Find a tutor
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Search by course code, subject or grade — then filter by what matters to you.
        </p>
        <RefineSearch
          className="mt-5"
          provinces={provinces}
          province={province ?? ""}
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

  // A search somebody actually ran — not a router prefetch — is recorded for
  // the "most searched" report once the page has been sent (R28.31).
  const isPrefetch = Boolean((await headers()).get("next-router-prefetch"));
  if (!isPrefetch) after(() => recordSearch(params, result));

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
        <LocationNotice location={result.resolved.location} province={result.resolved.province} />

        {result.items.length === 0 ? (
          <NoResults params={params} location={result.resolved.location} />
        ) : (
          <>
            <div className="mt-6 flex flex-col gap-5">
              {result.items.map((tutor) => (
                <TutorCard
                  key={tutor.id}
                  tutor={tutor}
                  layout="wide"
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
function NoResults({ params, location }) {
  const suggestions = [];
  const hasLocation = params.city || params.postalCode;
  if (hasLocation && params.mode !== "ONLINE") {
    // "Online or in person" keeps the location for in-person tutors and adds
    // every online one — it never throws the place away.
    if (params.mode) suggestions.push({ label: "Include online tutors", href: buildRelaxed(params, { mode: "" }) });
    if (params.distanceKm !== "any") {
      suggestions.push({ label: "Any distance", href: buildRelaxed(params, { distanceKm: "any" }) });
    }
  }
  if (location?.status === "UNRESOLVED" || location?.status === "INVALID") {
    suggestions.push({ label: "Search online tutors", href: buildRelaxed(params, { mode: "ONLINE", city: "", postalCode: "", distanceKm: "" }) });
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
  if (params.availability?.length || params.timeOfDay?.length || params.date || params.time) {
    suggestions.push({
      label: "Any availability",
      href: buildRelaxed(params, { availability: "", timeOfDay: "", date: "", time: "" }),
    });
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

/**
 * What happened to the location the visitor gave (R29.1). The search never
 * substitutes a place; when it could not use one as given, it says so.
 */
function LocationNotice({ location, province }) {
  if (!location || location.status === "NONE") return null;

  let icon = Info;
  let message = null;
  if (location.status === "INVALID") {
    icon = MapPinOff;
    message = `“${location.input}” isn't a Canadian postal code, so it couldn't be used for in-person lessons. Check it, or search by city.`;
  } else if (location.status === "UNRESOLVED") {
    icon = MapPinOff;
    message =
      location.kind === "POSTAL_CODE"
        ? `We couldn't place postal area ${location.input} on the map, so in-person results are tutors who list that postal area. Online tutors are shown as usual.`
        : `We couldn't place “${location.input}” on the map, so in-person results are tutors who list ${location.input} as their city. Online tutors are shown as usual.`;
  } else if (location.source === "TUTOR_DATA") {
    message = `Distances are approximate, measured from the centre of ${location.city} as given by the tutors who serve it.`;
  }

  const mismatch =
    location.provinceMismatch && province && location.provinceMismatch !== province.code
      ? `That location is outside ${province.name}, and you are searching ${province.name} courses — in-person tutors near it rarely teach them.`
      : null;

  if (!message && !mismatch) return null;
  const Icon = icon;
  return (
    <div
      role="status"
      className="mt-4 flex items-start gap-2.5 rounded-xl bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-inset ring-warning-100"
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{[message, mismatch].filter(Boolean).join(" ")}</p>
    </div>
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
        <div className="mt-6 flex flex-col gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <TutorCardSkeleton key={i} />
          ))}
        </div>
        <span className="sr-only">Loading tutors…</span>
      </div>
    </div>
  );
}

/** Mirrors the wide card's two-column shape so the swap doesn't jump. */
function TutorCardSkeleton() {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-3.5 sm:p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="aspect-[4/3] w-full rounded-xl" />
          <div className="grid grid-cols-5 gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-3.5">
          <div className="flex items-start gap-3">
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
