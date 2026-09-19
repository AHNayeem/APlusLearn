import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import { getTutorCalendar, getOrCreateAvailability } from "@/services/availability.service";
import { listConnections } from "@/services/calendar.service";
import { Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { TutorCalendar } from "@/components/calendar/TutorCalendar";
import { CalendarConnections } from "@/components/calendar/CalendarConnections";

export const metadata = { title: "Calendar" };
export const dynamic = "force-dynamic";

export default async function TutorCalendarPage({ searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/calendar");
  await connectToDatabase();

  const profile = await getTutorProfileByUserId(user.id);
  if (!profile) {
    return (
      <DashboardPage>
        <PageHeader title="Calendar" />
        <EmptyState
          title="Finish your application first"
          description="Your calendar opens once you've submitted your tutor application."
          action={<Button href="/tutor/onboarding">Continue application</Button>}
        />
      </DashboardPage>
    );
  }

  const { from } = await searchParams;
  await getOrCreateAvailability(profile.id, user.id, profile.timeZone);
  const [calendar, calendarSync] = await Promise.all([
    getTutorCalendar(profile.id, { from, days: 7 }),
    listConnections(user.id),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Calendar"
        description="Your week at a glance, plus the recurring hours families can book."
      />

      <TutorCalendar
        availability={calendar.availability}
        bookings={calendar.bookings}
        from={calendar.from}
        timeZone={calendar.availability?.timeZone ?? profile.timeZone ?? "America/Toronto"}
      />

      <div className="mt-8 max-w-3xl">
        <CalendarConnections initial={calendarSync} />
      </div>
    </DashboardPage>
  );
}
