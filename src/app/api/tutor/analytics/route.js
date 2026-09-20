import { routeHandler, ok } from "@/lib/api";
import { analyticsQuerySchema } from "@/lib/validation/admin";
import { tutorAnalytics } from "@/services/analytics.service";
import { PERMISSIONS } from "@/constants";

/**
 * A tutor's own performance (§41 Phase 2, §8, §10).
 *
 * The tutor is the signed-in user and nothing else. There is deliberately no
 * `tutorId` parameter: the only way to widen this endpoint would be to add
 * one, and its absence is the authorization control rather than a check that
 * could be forgotten.
 */
export const GET = routeHandler(
  async ({ user, query }) => ok({ analytics: await tutorAnalytics(user.id, query) }),
  { permission: PERMISSIONS.TUTOR_EARNINGS_VIEW, querySchema: analyticsQuerySchema },
);
