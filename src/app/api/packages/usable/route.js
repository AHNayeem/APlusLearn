import { routeHandler, ok } from "@/lib/api";
import { usablePackageQuerySchema } from "@/lib/validation/packages";
import { usablePackagesFor } from "@/services/package.service";
import { PERMISSIONS } from "@/constants";

/**
 * Balances that could pay for a specific lesson, for the booking form.
 *
 * Scoped to the caller's own purchases in the service, so this cannot be used
 * to discover what anybody else has bought (§36).
 */
export const GET = routeHandler(
  async ({ user, query }) => ok({ packages: await usablePackagesFor(user, query) }),
  { permission: PERMISSIONS.BOOKING_CREATE, querySchema: usablePackageQuerySchema },
);
