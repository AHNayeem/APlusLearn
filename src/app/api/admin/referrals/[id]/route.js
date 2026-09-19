import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { reverseReferral } from "@/services/referral.service";
import { PERMISSIONS } from "@/constants";

/**
 * Reverse a referral an administrator judges abusive, or whose qualifying
 * lesson was refunded outside the automatic path.
 *
 * Reversal is the only action offered: the requirements define no penalties
 * beyond taking back the reward, so the platform does not invent one.
 */
export const PATCH = routeHandler(
  async ({ user, params, body }) =>
    ok({ referral: await reverseReferral(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_PAYMENT_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: z.object({
      reason: z.string().trim().min(5, "Record why.").max(300),
    }),
  },
);
