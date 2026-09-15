import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { gradeSchema } from "@/lib/validation/admin";
import { objectId } from "@/lib/validation/common";
import { updateGrade } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ grade: await updateGrade(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: gradeSchema.partial(),
  },
);
