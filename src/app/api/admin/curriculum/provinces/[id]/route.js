import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { provinceSchema } from "@/lib/validation/admin";
import { objectId, patchSchema } from "@/lib/validation/common";
import { updateProvince, deleteProvince } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ province: await updateProvince(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: patchSchema(provinceSchema),
  },
);

/** Refuses while anything references it — deactivate instead. */
export const DELETE = routeHandler(
  async ({ user, params }) => ok(await deleteProvince(params.id, user)),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, paramsSchema: z.object({ id: objectId }) },
);
