import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getUser } from "@/services/user.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { SettingsPanels } from "@/components/dashboard/SettingsPanels";

export const metadata = { title: "My account" };
export const dynamic = "force-dynamic";

/**
 * An administrator's own account (§8, §24).
 *
 * Separate from `/admin/settings`, which configures the *platform*. This is
 * the same screen every other role gets, because an administrator has a name,
 * a photo and a password like anybody else — and until this page existed the
 * "Settings" item in their own menu pointed at a learner route that bounced
 * them straight back to the dashboard.
 *
 * The page being reachable is a convenience; `auth: true` on `/api/users/me`
 * and its avatar endpoint is the control, and those act on the session's own
 * account rather than on an id in the request.
 */
export default async function AdminAccountPage() {
  const session = await enforceRole(ROLES.ADMIN, "/admin/account");
  await connectToDatabase();
  const user = await getUser(session.id);

  return (
    <DashboardPage>
      <PageHeader
        title="My account"
        description="Your details, photo and sign-in security. Platform configuration lives under Settings."
      />
      <SettingsPanels user={user} />
    </DashboardPage>
  );
}
