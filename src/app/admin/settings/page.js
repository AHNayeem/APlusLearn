import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getSettings } from "@/services/settings.service";
import { BRANDING_ASSET_RULES } from "@/services/branding.service";
import { appEnv, integrationStatus } from "@/lib/config/env";
import { recentWebhookEvents } from "@/services/webhook.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { SettingsWorkspace } from "@/components/admin/settings/SettingsWorkspace";
import { IntegrationHealth } from "@/components/admin/IntegrationHealth";

export const metadata = { title: "Platform settings" };
export const dynamic = "force-dynamic";

/**
 * Platform settings (§26, §35).
 *
 * The role is enforced here *and* on every endpoint the panel calls — this
 * page being unreachable is a convenience; `ADMIN_SETTINGS_MANAGE` on the API
 * is the control.
 *
 * Integration health sits below the tabs rather than inside them because it is
 * not a setting: it reports what the deployment environment provides, and
 * nothing on this page can change it. Provider credentials belong in the
 * environment and are never stored in, or readable through, settings (§36).
 */
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
        description="Branding, appearance, metadata, marketplace rules and feature availability. Every change is recorded in the audit log."
      />

      <SettingsWorkspace settings={settings} assetRules={BRANDING_ASSET_RULES} />

      <div className="mt-8 max-w-3xl">
        <IntegrationHealth
          appEnv={appEnv()}
          integrations={integrationStatus()}
          webhooks={webhooks}
        />
      </div>
    </DashboardPage>
  );
}
