import { Plug } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getSettings, adminSettingsView } from "@/services/settings.service";
import { BRANDING_ASSET_RULES } from "@/services/branding.service";
import { appEnv, integrationStatus } from "@/lib/config/env";
import { recentWebhookEvents } from "@/services/webhook.service";
import { Alert, Button } from "@/components/ui";
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
 * nothing on *this* page can change it.
 *
 * Provider credentials are never stored in, or readable through, this
 * document (§36). They live in their own collection, encrypted, behind their
 * own permission — see `/admin/settings/integrations`. That separation is
 * deliberate: this settings document is memoised and its values reach client
 * components as branding, so a credential kept here would be one careless
 * prop away from a browser.
 */
export default async function AdminSettingsPage() {
  await enforceRole(ROLES.ADMIN, "/admin/settings");
  await connectToDatabase();

  const [settings, webhooks] = await Promise.all([
    getSettings({ fresh: true }),
    recentWebhookEvents({ limit: 10 }),
  ]);

  const integrations = integrationStatus();
  // The SMS panel says plainly whether texts reach a carrier on this
  // deployment, so an operator cannot switch the channel on and assume more
  // than it does (§38, §41 Phase 2).
  const smsProvider = integrations.find((row) => row.key === "sms") ?? null;

  return (
    <DashboardPage>
      <PageHeader
        title="Platform settings"
        description="Branding, appearance, metadata, marketplace rules and feature availability. Every change is recorded in the audit log."
      />

      <SettingsWorkspace
        settings={adminSettingsView(settings)}
        assetRules={BRANDING_ASSET_RULES}
        smsProvider={smsProvider}
      />

      <Alert tone="info" title="Credentials live on their own screen" className="mt-8 max-w-3xl">
        <p>
          API keys, webhook secrets and provider connection settings are managed under External
          modules, where they are encrypted at rest and never shown again once saved.
        </p>
        <Button
          href="/admin/settings/integrations"
          variant="secondary"
          size="sm"
          className="mt-3"
          iconLeft={<Plug className="size-4" />}
        >
          Open external modules
        </Button>
      </Alert>

      <div className="mt-8 max-w-3xl">
        <IntegrationHealth
          appEnv={appEnv()}
          integrations={integrations}
          webhooks={webhooks}
        />
      </div>
    </DashboardPage>
  );
}
