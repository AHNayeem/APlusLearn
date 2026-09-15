import { routeHandler, created } from "@/lib/api";
import { gradeSchema } from "@/lib/validation/admin";
import { createGrade } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, body }) => created({ grade: await createGrade(body, user) }),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, bodySchema: gradeSchema },
);
