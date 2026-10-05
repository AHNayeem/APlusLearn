import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { gradeSchema } from "@/lib/validation/admin";
import { objectId, patchSchema } from "@/lib/validation/common";
import { updateGrade, deleteGrade } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ grade: await updateGrade(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: patchSchema(gradeSchema),
  },
);

/** Refuses while anything references it — deactivate instead. */
export const DELETE = routeHandler(
  async ({ user, params }) => ok(await deleteGrade(params.id, user)),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, paramsSchema: z.object({ id: objectId }) },
);
