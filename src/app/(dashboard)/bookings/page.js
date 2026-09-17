import { CalendarDays, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listBookings } from "@/services/booking.service";
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

  const { items, total, page, pageSize } = await listBookings(user, params);
  const empty = EMPTY_COPY[params.scope] ?? EMPTY_COPY.UPCOMING;

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
          href: `/bookings?scope=${tab.value}`,
        }))}
      />

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
          buildHref={(p) => `/bookings?scope=${params.scope}&page=${p}`}
        />
      </div>
    </DashboardPage>
  );
}
