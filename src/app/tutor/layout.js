import { enforceRole } from "@/lib/auth/guards";
import { navForRole, ROLES } from "@/constants";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { unreadNotificationCount } from "@/services/notification.service";
import { unreadMessageCount } from "@/services/message.service";
import { connectToDatabase } from "@/lib/db/connect";

/** Tutor workspace. Every route below is tutor-only, enforced server-side (§10). */
export default async function TutorLayout({ children }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/dashboard");
  await connectToDatabase();

  const [unreadNotifications, unreadMessages] = await Promise.all([
    unreadNotificationCount(user.id),
    unreadMessageCount(user.id),
  ]);

  return (
    <DashboardShell
      items={navForRole(ROLES.TUTOR)}
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
