import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { updatePackageSchema, packageStatusSchema } from "@/lib/validation/packages";
import { updatePackage, setPackageStatus } from "@/services/package.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

/** Edit an offer. Balances already bought carry their own terms and are untouched. */
export const PATCH = routeHandler(
  async ({ user, params: p, body }) => ok({ package: await updatePackage(p.id, body, user) }),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    paramsSchema: params,
    bodySchema: updatePackageSchema,
  },
);

/** Put it on sale, pause it, or archive it. */
export const POST = routeHandler(
  async ({ user, params: p, body }) => ok({ package: await setPackageStatus(p.id, body, user) }),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    paramsSchema: params,
    bodySchema: packageStatusSchema,
  },
);
