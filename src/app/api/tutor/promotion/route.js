import { routeHandler, ok } from "@/lib/api";
import { myPromotion } from "@/services/promotion.service";
import { PERMISSIONS } from "@/constants";

/**
 * What a tutor may know about their own promoted placement (§41 Phase 2).
 *
 * Read-only, and scoped to the session: the tutor profile is resolved from
 * the signed-in user, so there is no id to tamper with. Promotions are
 * granted by administrators, so there is no write here at all.
 */
export const GET = routeHandler(
  async ({ user }) => ok({ promotion: await myPromotion(user) }),
  { permission: PERMISSIONS.TUTOR_PROFILE_EDIT },
);
