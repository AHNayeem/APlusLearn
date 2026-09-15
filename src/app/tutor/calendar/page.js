import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import { getTutorCalendar, getOrCreateAvailability } from "@/services/availability.service";
import { calendarIntegrationsStatus } from "@/services/external/calendar-provider";
import { Alert, Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { TutorCalendar } from "@/components/calendar/TutorCalendar";

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
  const calendar = await getTutorCalendar(profile.id, { from, days: 7 });
  const integrations = calendarIntegrationsStatus();

  return (
    <DashboardPage>
      <PageHeader
        title="Calendar"
        description="Your week at a glance, plus the recurring hours families can book."
      />

      {!integrations.some((i) => i.connected) && (
        <Alert tone="neutral" title="Calendar sync is coming" className="mb-6">
          Google Calendar and Outlook sync are on the roadmap. For now, block any time you&rsquo;re
          busy elsewhere so nothing double-books.
        </Alert>
      )}

      <TutorCalendar
        availability={calendar.availability}
        bookings={calendar.bookings}
        from={calendar.from}
        timeZone={calendar.availability?.timeZone ?? profile.timeZone ?? "America/Toronto"}
      />
    </DashboardPage>
  );
}
