import { z } from "zod";
import { routeHandler, ok, created } from "@/lib/api";
import { createPackageSchema } from "@/lib/validation/packages";
import { listPackagesForTutor, createPackage } from "@/services/package.service";
import { PERMISSIONS, PACKAGE_STATUS } from "@/constants";

/** A tutor's own package offers (§41 Phase 2). */
export const GET = routeHandler(
  async ({ user, query }) => ok(await listPackagesForTutor(user, query)),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    querySchema: z.object({ status: z.enum(Object.values(PACKAGE_STATUS)).optional() }),
  },
);

/**
 * Create one. The price is the tutor's, but it is checked against their own
 * published rate: a package may not cost more per hour than booking the same
 * lessons individually.
 */
export const POST = routeHandler(
  async ({ user, body }) => created({ package: await createPackage(body, user) }),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    verifiedEmail: true,
    bodySchema: createPackageSchema,
  },
);
