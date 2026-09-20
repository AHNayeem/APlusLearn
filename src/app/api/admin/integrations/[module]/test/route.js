import { routeHandler, ok } from "@/lib/api";
import { PERMISSIONS, AUDIT_ACTIONS } from "@/constants";
import { testIntegrationModule } from "@/services/integration.service";
import { recordAudit } from "@/services/audit.service";
import {
  integrationTestSchema,
  integrationParamsSchema,
} from "@/lib/validation/integrations";

/**
 * Make a real call to the real provider (§39).
 *
 * The configuration under test is always the *stored* one — the body carries
 * only a destination for the modules that can deliver something, never
 * credentials. So a passing result cannot be manufactured by posting keys
 * that were never saved, and "connected" always means "connected with what is
 * actually deployed".
 *
 * The attempt is audited whether it passed or failed: a run of failures
 * against a payment module is exactly the kind of thing an operator wants to
 * find in the log afterwards.
 */
export const POST = routeHandler(
  async ({ request, user, params, body }) => {
    const result = await testIntegrationModule(params.module, body, user);

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.INTEGRATION_TESTED,
      entityType: "Integration",
      request,
      metadata: {
        module: params.module,
        provider: result.provider,
        ok: result.ok,
        code: result.code,
        // Whether a destination was supplied, never which one: a test
        // recipient is somebody's address and does not belong in the log.
        delivered: Boolean(body?.recipient || body?.phone),
      },
    });

    return ok({ result });
  },
  {
    permission: PERMISSIONS.ADMIN_INTEGRATION_MANAGE,
    paramsSchema: integrationParamsSchema,
    bodySchema: integrationTestSchema,
  },
);
