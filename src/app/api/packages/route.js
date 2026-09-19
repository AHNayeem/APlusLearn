import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { purchasePackageSchema, purchaseQuerySchema } from "@/lib/validation/packages";
import { listPurchases, purchasePackage } from "@/services/package.service";
import { PERMISSIONS } from "@/constants";

/** A family's packages and the lessons left in them. */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listPurchases(user, query);
    return ok({ purchases: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.BOOKING_VIEW, querySchema: purchaseQuerySchema },
);

/**
 * Buy a package.
 *
 * Creates an ordinary payment and settles through the same webhook as a
 * lesson; nothing is usable until that payment lands (§20, §41 Phase 2).
 */
export const POST = routeHandler(
  async ({ user, body }) => created(await purchasePackage(body, user)),
  {
    permission: PERMISSIONS.BOOKING_CREATE,
    verifiedEmail: true,
    bodySchema: purchasePackageSchema,
  },
);
