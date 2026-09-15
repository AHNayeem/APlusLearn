import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getSettings } from "@/services/settings.service";
import { appEnv, integrationStatus } from "@/lib/config/env";
import { recentWebhookEvents } from "@/services/webhook.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { PlatformSettings } from "@/components/admin/PlatformSettings";
import { IntegrationHealth } from "@/components/admin/IntegrationHealth";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await enforceRole(ROLES.ADMIN, "/admin/settings");
  await connectToDatabase();

  const [settings, webhooks] = await Promise.all([
    getSettings({ fresh: true }),
    recentWebhookEvents({ limit: 10 }),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Platform settings"
        description="Commission, cancellation policy and booking rules. Every change is recorded in the audit log."
      />
      <PlatformSettings settings={settings} />

      <div className="mt-6">
        <IntegrationHealth
          appEnv={appEnv()}
          integrations={integrationStatus()}
          webhooks={webhooks}
        />
      </div>
    </DashboardPage>
  );
}
