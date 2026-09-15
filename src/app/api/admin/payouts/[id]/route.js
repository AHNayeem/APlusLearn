import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { payoutActionSchema } from "@/lib/validation/admin";
import { objectId } from "@/lib/validation/common";
import { updatePayoutStatus } from "@/services/payout.service";
import { PERMISSIONS } from "@/constants";

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ payout: await updatePayoutStatus(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_PAYOUT_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: payoutActionSchema,
  },
);
