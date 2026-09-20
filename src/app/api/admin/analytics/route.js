import { routeHandler, ok } from "@/lib/api";
import { analyticsQuerySchema } from "@/lib/validation/admin";
import {
  marketplaceOverview,
  marketplaceBreakdowns,
  phaseTwoAnalytics,
  tutorLeaderboard,
} from "@/services/analytics.service";
import { PERMISSIONS } from "@/constants";

/**
 * Platform-wide analytics (§25, §41 Phase 2).
 *
 * Everything here is marketplace-scoped, so it sits behind the analytics
 * permission and takes no owner parameter at all — there is no id a caller
 * could supply to widen or redirect what they are shown.
 */
export const GET = routeHandler(
  async ({ query }) => {
    const [overview, breakdowns, phaseTwo, leaderboard] = await Promise.all([
      marketplaceOverview(query),
      marketplaceBreakdowns(query),
      phaseTwoAnalytics(query),
      tutorLeaderboard(query),
    ]);
    return ok({ overview, breakdowns, phaseTwo, leaderboard });
  },
  { permission: PERMISSIONS.ADMIN_ANALYTICS_VIEW, querySchema: analyticsQuerySchema },
);
