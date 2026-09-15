import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { courseSchema } from "@/lib/validation/admin";
import { objectId } from "@/lib/validation/common";
import { updateCourse, deleteCourse } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ course: await updateCourse(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE,
    paramsSchema,
    bodySchema: courseSchema.partial(),
  },
);

/** Refuses to delete a course any tutor still teaches. */
export const DELETE = routeHandler(
  async ({ user, params }) => ok(await deleteCourse(params.id, user)),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, paramsSchema },
);
