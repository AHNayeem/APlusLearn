import { enforceRole } from "@/lib/auth/guards";
import { navForRole, ROLES } from "@/constants";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getAppConfig } from "@/services/settings.service";
import { unreadNotificationCount } from "@/services/notification.service";
import { unreadMessageCount } from "@/services/message.service";
import { connectToDatabase } from "@/lib/db/connect";

/** Tutor workspace. Every route below is tutor-only, enforced server-side (§10). */
export default async function TutorLayout({ children }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/dashboard");
  await connectToDatabase();

  const [unreadNotifications, unreadMessages, config] = await Promise.all([
    unreadNotificationCount(user.id),
    unreadMessageCount(user.id),
    getAppConfig(),
  ]);

  return (
    <DashboardShell
      branding={config.branding}
      items={navForRole(ROLES.TUTOR, config.features)}
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
