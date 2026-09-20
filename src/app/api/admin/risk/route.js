import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { riskCaseQuerySchema } from "@/lib/validation/risk";
import { listRiskCases, riskOverview } from "@/services/risk.service";
import { PERMISSIONS } from "@/constants";

/**
 * The risk review queue (§41 Phase 2).
 *
 * Administrators only, and nothing here is ever exposed to the account a case
 * is about: a person under review is told nothing beyond the warning an
 * administrator chooses to send them.
 */
export const GET = routeHandler(
  async ({ query }) => {
    const [{ items, total, page, pageSize }, overview] = await Promise.all([
      listRiskCases(query),
      riskOverview(),
    ]);
    return ok({ cases: items, overview }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_RISK_MANAGE, querySchema: riskCaseQuerySchema },
);
