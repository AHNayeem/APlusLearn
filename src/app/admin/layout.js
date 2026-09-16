import { enforceRole } from "@/lib/auth/guards";
import { navForRole, ROLES } from "@/constants";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { getAppConfig } from "@/services/settings.service";
import { adminQueueCounts } from "@/services/analytics.service";
import { connectToDatabase } from "@/lib/db/connect";

/**
 * Admin console. Role is enforced server-side on every request, and each
 * individual action re-checks its own permission (§10, §35, §36).
 */
export default async function AdminLayout({ children }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/dashboard");
  await connectToDatabase();

  const [counts, config] = await Promise.all([adminQueueCounts(), getAppConfig()]);

  return (
    <DashboardShell
      branding={config.branding}
      items={navForRole(ROLES.ADMIN, config.features)}
      user={{
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      }}
      badges={{
        pendingApplications: counts.pendingApplications,
        openDisputes: counts.openDisputes,
        reportedReviews: counts.reportedReviews,
        reportedConversations: counts.reportedConversations,
      }}
    >
      {children}
    </DashboardShell>
  );
}
