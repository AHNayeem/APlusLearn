import { enforceRole } from "@/lib/auth/guards";
import { navForRole, LEARNER_ROLES } from "@/constants";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
import { getAppConfig } from "@/services/settings.service";
import { unreadNotificationCount } from "@/services/notification.service";
import { unreadMessageCount } from "@/services/message.service";
import { connectToDatabase } from "@/lib/db/connect";
import { SupportWidget } from "@/components/support/SupportWidget";

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

  const [unreadNotifications, unreadMessages, config] = await Promise.all([
    unreadNotificationCount(user.id),
    unreadMessageCount(user.id),
    getAppConfig(),
  ]);

  return (
    <>
      <DashboardShell
        branding={config.branding}
        items={navForRole(user.role, config.features)}
        user={{
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          avatarUrl: user.avatarUrl,
        }}
        badges={{ unreadNotifications, unreadMessages }}
      >
        {!user.emailVerifiedAt && <VerifyEmailBanner email={user.email} />}
        {children}
      </DashboardShell>
      {/* Floating help launcher. It resolves the visitor itself. */}
      <SupportWidget />
    </>
  );
}
