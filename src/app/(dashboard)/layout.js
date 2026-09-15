import { enforceRole } from "@/lib/auth/guards";
import { navForRole, LEARNER_ROLES } from "@/constants";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { unreadNotificationCount } from "@/services/notification.service";
import { unreadMessageCount } from "@/services/message.service";
import { connectToDatabase } from "@/lib/db/connect";

/**
 * Parent/student dashboard shell.
 *
 * `enforceRole` runs server-side on every request, so no dashboard route is
 * reachable by a tutor or a signed-out visitor regardless of what the client
 * does (§10, §35).
 */
export default async function DashboardLayout({ children }) {
  const user = await enforceRole(LEARNER_ROLES, "/dashboard");
  await connectToDatabase();

  const [unreadNotifications, unreadMessages] = await Promise.all([
    unreadNotificationCount(user.id),
    unreadMessageCount(user.id),
  ]);

  return (
    <DashboardShell
      items={navForRole(user.role)}
      user={{
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      }}
      badges={{ unreadNotifications, unreadMessages }}
    >
      {children}
    </DashboardShell>
  );
}
