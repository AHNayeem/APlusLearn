import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { listIntegrationModules } from "@/services/integration.service";
import { recentWebhookEvents } from "@/services/webhook.service";
import { appEnv, integrationStatus } from "@/lib/config/env";
import { toPlain } from "@/lib/utils/serialize";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { Alert } from "@/components/ui";
import { IntegrationsWorkspace } from "@/components/admin/integrations/IntegrationsWorkspace";
import { IntegrationHealth } from "@/components/admin/IntegrationHealth";

export const metadata = { title: "External modules" };
export const dynamic = "force-dynamic";

/**
 * External modules / integrations (§26, §36, §38).
 *
 * The role is enforced here *and* by `ADMIN_INTEGRATION_MANAGE` on every
 * endpoint the panel calls. This page being unreachable is a convenience; the
 * permission on the API is the control, and `bun run qa` asserts a direct
 * call from a parent or tutor account is refused.
 *
 * Nothing on this page is a credential. The service reduces every secret to
 * whether it exists before the payload is built, so there is no value here
 * for a server component to hand to a client one by accident.
 *
 * The environment health table stays underneath, because it reports something
 * this screen cannot change: which providers the *deployment* offers, and
 * which are running their development implementation.
 */
export default async function AdminIntegrationsPage() {
  await enforceRole(ROLES.ADMIN, "/admin/settings/integrations");
  await connectToDatabase();

  const [{ modules }, webhooks] = await Promise.all([
    listIntegrationModules(),
    recentWebhookEvents({ limit: 10 }),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="External modules"
        description="Credentials and connection settings for the services this platform talks to. Every change is recorded in the audit log; stored credentials are encrypted and are never shown again once saved."
        action={
          <Link
            href="/admin/settings"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Platform settings
          </Link>
        }
      />

      <Alert tone="info" title="Where these values come from" className="mb-6 max-w-3xl">
        A module configured here overrides the matching environment variables. One left alone keeps
        reading the environment, so a deployment that has never opened this screen behaves exactly as
        it always did. <strong>AUTH_SECRET</strong>, <strong>MONGODB_URI</strong> and the
        application&rsquo;s own URL stay in the environment and are deliberately not editable here.
      </Alert>

      <IntegrationsWorkspace modules={toPlain(modules)} />

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
