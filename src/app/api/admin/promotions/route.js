import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { createPromotionSchema, promotionQuerySchema } from "@/lib/validation/promotions";
import { listPromotions, createPromotion } from "@/services/promotion.service";
import { PERMISSIONS } from "@/constants";

/** The promoted-profile register (§41 Phase 2). */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listPromotions(query);
    return ok({ promotions: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_PROMOTION_MANAGE, querySchema: promotionQuerySchema },
);

/**
 * Promote a tutor.
 *
 * The request names a tutor and a window and nothing else. Whether that tutor
 * may be promoted at all is decided from their stored profile and account
 * state, never from the request (§42).
 */
export const POST = routeHandler(
  async ({ user, body }) => created({ promotion: await createPromotion(body, user) }),
  {
    permission: PERMISSIONS.ADMIN_PROMOTION_MANAGE,
    bodySchema: createPromotionSchema,
  },
);
