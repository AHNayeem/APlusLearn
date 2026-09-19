import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { purchaseQuerySchema } from "@/lib/validation/packages";
import { listAllPurchases } from "@/services/package.service";
import { PERMISSIONS } from "@/constants";

/** Every package purchase, for support and reconciliation (§41 Phase 2). */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize, totals } = await listAllPurchases(query);
    return ok({ purchases: items, totals }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_PAYMENT_MANAGE, querySchema: purchaseQuerySchema },
);
