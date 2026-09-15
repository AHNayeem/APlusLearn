import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { listNotifications } from "@/services/notification.service";
import { Button } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { NotificationsList } from "@/components/dashboard/NotificationsList";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function TutorNotificationsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/notifications");
  await connectToDatabase();

  const { items, unreadCount } = await listNotifications(user.id, { pageSize: 40 });

  return (
    <DashboardPage>
      <PageHeader
        title="Notifications"
        description="Bookings, messages, verification decisions and payouts."
        action={
          <Button href="/tutor/settings#notifications" variant="secondary">
            Notification settings
          </Button>
        }
      />
      <NotificationsList notifications={items} unreadCount={unreadCount} />
    </DashboardPage>
  );
}
