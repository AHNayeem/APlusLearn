import Link from "next/link";
import { CalendarDays, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listBookings } from "@/services/booking.service";
import { listStudents } from "@/services/student.service";
import { bookingListQuerySchema } from "@/lib/validation/bookings";
import { Button, Card, CardBody, EmptyState, LinkTabs, Pagination } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { BookingRow } from "@/components/booking/BookingRow";

export const metadata = { title: "My lessons" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "PAST", label: "Past" },
  { value: "AWAITING_REVIEW", label: "To review" },
  { value: "CANCELLED", label: "Cancelled & expired" },
];

const EMPTY_COPY = {
  UPCOMING: {
    title: "No upcoming lessons",
    description: "Book a lesson and it will appear here with the meeting link or location.",
  },
  PAST: {
    title: "No past lessons yet",
    description: "Completed lessons and their receipts are kept here.",
  },
  AWAITING_REVIEW: {
    title: "Nothing waiting for a review",
    description: "After a lesson is completed you'll be able to review it here.",
  },
  CANCELLED: {
    title: "No cancelled lessons",
    description:
      "Cancellations, any refunds applied, and lessons whose payment was never completed are listed here.",
  },
};

export default async function BookingsPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/bookings");
  await connectToDatabase();

  const raw = await searchParams;
  const parsed = bookingListQuerySchema.safeParse(raw);
  const params = parsed.success ? parsed.data : bookingListQuerySchema.parse({});

  /**
   * One child's lessons (R3.2). The id has passed the shared schema; it is
   * honoured only if it names one of this account's own learners — archived
   * ones included, since their past lessons are still theirs. Anything else
   * is dropped rather than refused. The service scopes every list to the
   * purchaser regardless, so a foreign id could only ever return nothing.
   */
  const children = await listStudents(user, { includeArchived: true });
  const childId = children.some((c) => c.id === params.studentProfileId)
    ? params.studentProfileId
    : undefined;

  const { items, total, page, pageSize } = await listBookings(user, {
    ...params,
    studentProfileId: childId,
  });
  const empty = EMPTY_COPY[params.scope] ?? EMPTY_COPY.UPCOMING;
  const hrefFor = (overrides) => {
    const query = new URLSearchParams({ scope: params.scope });
    const child = overrides.child === undefined ? childId : overrides.child;
    if (child) query.set("studentProfileId", child);
    if (overrides.scope) query.set("scope", overrides.scope);
    if (overrides.page) query.set("page", String(overrides.page));
    return `/bookings?${query}`;
  };

  return (
    <DashboardPage>
      <PageHeader
        title="My lessons"
        description="Every lesson you've booked, with meeting links, receipts and cancellation options."
        action={
          <Button href="/find-a-tutor" iconLeft={<Search className="size-4" />}>
            Book a lesson
          </Button>
        }
      />

      <LinkTabs
        activeValue={params.scope}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: hrefFor({ scope: tab.value }),
        }))}
      />

      {children.length > 1 && (
        <nav aria-label="Filter by child" className="mt-4 flex flex-wrap gap-2">
          {[{ id: null, firstName: "All children" }, ...children].map((child) => {
            const active = (child.id ?? undefined) === childId;
            return (
              <Link
                key={child.id ?? "all"}
                href={hrefFor({ child: child.id ?? null })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 bg-white text-ink-700 hover:border-brand-400",
                )}
              >
                {child.firstName}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-7" />}
            title={empty.title}
            description={empty.description}
            action={<Button href="/find-a-tutor">Find a tutor</Button>}
          />
        ) : (
          <Card>
            <CardBody className="p-0">
              <ul className="divide-y divide-ink-100">
                {items.map((booking) => (
                  <li key={booking.id}>
                    <BookingRow booking={booking} viewerRole={user.role} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <Pagination
          className="mt-6"
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          label="lessons"
          buildHref={(p) => hrefFor({ page: p })}
        />
      </div>
    </DashboardPage>
  );
}
