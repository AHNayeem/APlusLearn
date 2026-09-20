import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { promotionActionSchema } from "@/lib/validation/promotions";
import {
  getPromotion,
  activatePromotion,
  pausePromotion,
  extendPromotion,
  cancelPromotion,
} from "@/services/promotion.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ params }) => ok({ promotion: await getPromotion(params.id) }),
  {
    permission: PERMISSIONS.ADMIN_PROMOTION_MANAGE,
    paramsSchema: z.object({ id: objectId }),
  },
);

/**
 * Move a promotion through its lifecycle.
 *
 * The body names an action, never a status: which transitions are legal from
 * where is the server's to decide, and a terminal promotion is refused by the
 * service rather than quietly reopened.
 */
export const PATCH = routeHandler(
  async ({ user, params, body }) => {
    const promotion = await run(params.id, body, user);
    return ok({ promotion });
  },
  {
    permission: PERMISSIONS.ADMIN_PROMOTION_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: promotionActionSchema,
  },
);

function run(id, body, user) {
  switch (body.action) {
    case "ACTIVATE":
      return activatePromotion(id, user);
    case "PAUSE":
      return pausePromotion(id, user);
    case "EXTEND":
      return extendPromotion(id, { endsAt: body.endsAt }, user);
    case "CANCEL":
    default:
      return cancelPromotion(id, { reason: body.reason }, user);
  }
}
