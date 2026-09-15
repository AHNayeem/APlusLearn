import { routeHandler, created } from "@/lib/api";
import { subjectSchema } from "@/lib/validation/admin";
import { createSubject } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, body }) => created({ subject: await createSubject(body, user) }),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, bodySchema: subjectSchema },
);
