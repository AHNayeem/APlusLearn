import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { subjectSchema } from "@/lib/validation/admin";
import { objectId, patchSchema } from "@/lib/validation/common";
import { updateSubject, deleteSubject } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ subject: await updateSubject(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: patchSchema(subjectSchema),
  },
);

/** Refuses while anything references it — deactivate instead. */
export const DELETE = routeHandler(
  async ({ user, params }) => ok(await deleteSubject(params.id, user)),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, paramsSchema: z.object({ id: objectId }) },
);
