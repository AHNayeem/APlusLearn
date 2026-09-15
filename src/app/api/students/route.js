import { routeHandler, ok, created } from "@/lib/api";
import { studentProfileSchema } from "@/lib/validation/users";
import { listStudents, createStudent } from "@/services/student.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) =>
    ok({ students: await listStudents(user, { includeArchived: query.archived === "true" }) }),
  { auth: true },
);

export const POST = routeHandler(
  async ({ user, body }) => created({ student: await createStudent(body, user) }),
  { permission: PERMISSIONS.CHILD_MANAGE, bodySchema: studentProfileSchema },
);
