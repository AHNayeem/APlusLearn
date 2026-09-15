import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getSettings } from "@/services/settings.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { PlatformSettings } from "@/components/admin/PlatformSettings";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await enforceRole(ROLES.ADMIN, "/admin/settings");
  await connectToDatabase();

  const settings = await getSettings({ fresh: true });

  return (
    <DashboardPage>
      <PageHeader
        title="Platform settings"
        description="Commission, cancellation policy and booking rules. Every change is recorded in the audit log."
      />
      <PlatformSettings settings={settings} />
    </DashboardPage>
  );
}
