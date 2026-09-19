import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { cancelPurchaseSchema } from "@/lib/validation/packages";
import { getPurchase, cancelPurchase } from "@/services/package.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ user, params: p }) => ok(await getPurchase(p.id, user)),
  { permission: PERMISSIONS.BOOKING_VIEW, paramsSchema: params },
);

/**
 * Cancel a package and refund what was not used.
 *
 * Lessons already booked from it stay booked: cancelling a balance is not a
 * way around the cancellation policy (§26).
 */
export const DELETE = routeHandler(
  async ({ user, params: p, body }) => ok(await cancelPurchase(p.id, body ?? {}, user)),
  {
    permission: PERMISSIONS.BOOKING_CANCEL,
    paramsSchema: params,
    bodySchema: cancelPurchaseSchema,
  },
);
