import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { riskCaseActionSchema } from "@/lib/validation/risk";
import { getRiskCase, reviewRiskCase, resolveRiskCase } from "@/services/risk.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ params }) => ok({ case: await getRiskCase(params.id) }),
  { permission: PERMISSIONS.ADMIN_RISK_MANAGE, paramsSchema: z.object({ id: objectId }) },
);

/**
 * Move a case through review.
 *
 * The body names an action, never a status, level or score: which transitions
 * are legal is the server's to decide, and a resolved case is refused rather
 * than silently reopened — its signals and decisions are evidence (§41).
 */
export const PATCH = routeHandler(
  async ({ user, params, body }) => {
    const updated =
      body.action === "REVIEW"
        ? await reviewRiskCase(params.id, user)
        : await resolveRiskCase(
            params.id,
            { resolution: body.resolution, note: body.note, action: body.outcome },
            user,
          );
    return ok({ case: updated });
  },
  {
    permission: PERMISSIONS.ADMIN_RISK_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: riskCaseActionSchema,
  },
);
