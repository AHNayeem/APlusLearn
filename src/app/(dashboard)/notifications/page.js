import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listNotifications } from "@/services/notification.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { NotificationsList } from "@/components/dashboard/NotificationsList";
import { Button } from "@/components/ui";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await enforceRole(LEARNER_ROLES, "/notifications");
  await connectToDatabase();

  const { items, unreadCount } = await listNotifications(user.id, { pageSize: 40 });

  return (
    <DashboardPage>
      <PageHeader
        title="Notifications"
        description="Bookings, messages, refunds and reminders."
        action={
          <Button href="/settings#notifications" variant="secondary">
            Notification settings
          </Button>
        }
      />
      <NotificationsList notifications={items} unreadCount={unreadCount} />
    </DashboardPage>
  );
}
