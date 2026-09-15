import { CalendarDays } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { listBookings } from "@/services/booking.service";
import { bookingListQuerySchema } from "@/lib/validation/bookings";
import { Button, Card, CardBody, EmptyState, LinkTabs, Pagination } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { BookingRow } from "@/components/booking/BookingRow";

export const metadata = { title: "Lessons" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "PAST", label: "Past" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "ALL", label: "All" },
];

export default async function TutorBookingsPage({ searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/bookings");
  await connectToDatabase();

  const raw = await searchParams;
  const parsed = bookingListQuerySchema.safeParse(raw);
  const params = parsed.success ? parsed.data : bookingListQuerySchema.parse({});

  const { items, total, page, pageSize } = await listBookings(user, params);

  return (
    <DashboardPage>
      <PageHeader
        title="Lessons"
        description="Every lesson you've taught or have coming up."
        action={<Button href="/tutor/calendar" variant="secondary">Open calendar</Button>}
      />

      <LinkTabs
        activeValue={params.scope}
        tabs={TABS.map((tab) => ({ ...tab, href: `/tutor/bookings?scope=${tab.value}` }))}
      />

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-7" />}
            title="No lessons here"
            description="Keep your availability current — families book the tutors whose calendars are open."
            action={<Button href="/tutor/calendar">Update availability</Button>}
          />
        ) : (
          <Card>
            <CardBody className="p-0">
              <ul className="divide-y divide-ink-100">
                {items.map((booking) => (
                  <li key={booking.id}>
                    <BookingRow booking={booking} viewerRole={ROLES.TUTOR} />
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
          buildHref={(p) => `/tutor/bookings?scope=${params.scope}&page=${p}`}
        />
      </div>
    </DashboardPage>
  );
}
