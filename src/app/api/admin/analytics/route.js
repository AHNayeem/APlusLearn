import { routeHandler, ok } from "@/lib/api";
import { analyticsQuerySchema } from "@/lib/validation/admin";
import { marketplaceOverview, marketplaceBreakdowns } from "@/services/analytics.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ query }) => {
    const [overview, breakdowns] = await Promise.all([
      marketplaceOverview(query),
      marketplaceBreakdowns(query),
    ]);
    return ok({ overview, breakdowns });
  },
  { permission: PERMISSIONS.ADMIN_ANALYTICS_VIEW, querySchema: analyticsQuerySchema },
);
