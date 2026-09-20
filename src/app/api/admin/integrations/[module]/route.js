import { routeHandler, ok } from "@/lib/api";
import { PERMISSIONS, AUDIT_ACTIONS } from "@/constants";
import {
  getIntegrationModule,
  updateIntegrationModule,
  importIntegrationFromEnvironment,
  clearIntegrationModule,
} from "@/services/integration.service";
import { recordAudit } from "@/services/audit.service";
import {
  integrationPatchEnvelopeSchema,
  integrationParamsSchema,
} from "@/lib/validation/integrations";

/** One module. Secrets are already reduced to their existence by the service. */
export const GET = routeHandler(
  async ({ params }) => ok({ module: await getIntegrationModule(params.module) }),
  {
    permission: PERMISSIONS.ADMIN_INTEGRATION_MANAGE,
    paramsSchema: integrationParamsSchema,
  },
);

/**
 * Save a module's configuration (§26, §36).
 *
 * An omitted secret keeps what is stored and an explicit `null` clears it, so
 * a form can change a port number without ever having held the password. The
 * envelope schema bounds the shape here; the strict, provider-specific schema
 * runs in the service, which is the only layer that can also see the stored
 * record.
 *
 * Two audit records rather than one where a rotation happened: an operator
 * reading the log is usually asking "when did the Stripe key last change",
 * and making that its own action means they can filter for it.
 */
export const PATCH = routeHandler(
  async ({ request, user, params, body }) => {
    const { module, changes } = await updateIntegrationModule(params.module, body, user);

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.INTEGRATION_UPDATED,
      entityType: "Integration",
      request,
      // Field names and transitions. No credential value, masked or otherwise.
      metadata: { module: params.module, provider: module.provider, changes },
    });

    if (changes.enabled) {
      await recordAudit({
        actor: user,
        action: changes.enabled.to
          ? AUDIT_ACTIONS.INTEGRATION_ENABLED
          : AUDIT_ACTIONS.INTEGRATION_DISABLED,
        entityType: "Integration",
        request,
        metadata: { module: params.module },
      });
    }

    if (changes.provider) {
      await recordAudit({
        actor: user,
        action: AUDIT_ACTIONS.INTEGRATION_PROVIDER_CHANGED,
        entityType: "Integration",
        request,
        metadata: { module: params.module, ...changes.provider },
      });
    }

    if (changes.secretsRotated?.length || changes.secretsCleared?.length) {
      await recordAudit({
        actor: user,
        action: AUDIT_ACTIONS.INTEGRATION_SECRET_ROTATED,
        entityType: "Integration",
        request,
        metadata: {
          module: params.module,
          rotated: changes.secretsRotated ?? [],
          cleared: changes.secretsCleared ?? [],
        },
      });
    }

    return ok({ module });
  },
  {
    permission: PERMISSIONS.ADMIN_INTEGRATION_MANAGE,
    paramsSchema: integrationParamsSchema,
    bodySchema: integrationPatchEnvelopeSchema,
  },
);

/**
 * Adopt the credentials this deployment already has in its environment.
 *
 * A POST with no body: it takes nothing from the caller, which is the point —
 * the values move from `process.env` into encrypted storage server-side and
 * never pass through a browser in either direction.
 */
export const POST = routeHandler(
  async ({ request, user, params }) => {
    const { module, changes } = await importIntegrationFromEnvironment(params.module, user);

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.INTEGRATION_IMPORTED_FROM_ENV,
      entityType: "Integration",
      request,
      metadata: { module: params.module, provider: module.provider, changes },
    });

    return ok({ module });
  },
  {
    permission: PERMISSIONS.ADMIN_INTEGRATION_MANAGE,
    paramsSchema: integrationParamsSchema,
  },
);

/**
 * Hand a module back to the deployment environment (§26).
 *
 * The way out of the admin panel. Deleting the stored record — credentials
 * and all — returns the module to whatever the environment says, which is
 * both the escape hatch for a configuration saved by mistake and the correct
 * way to decommission a provider you are no longer using.
 *
 * Not a soft delete. An operator removing a provider usually wants those
 * credentials gone, not archived where the next person can find them.
 */
export const DELETE = routeHandler(
  async ({ request, user, params }) => {
    const { module, changes } = await clearIntegrationModule(params.module);

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.INTEGRATION_UPDATED,
      entityType: "Integration",
      request,
      metadata: { module: params.module, changes },
    });

    return ok({ module });
  },
  {
    permission: PERMISSIONS.ADMIN_INTEGRATION_MANAGE,
    paramsSchema: integrationParamsSchema,
  },
);
