import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { updateStudentProfileSchema } from "@/lib/validation/users";
import { objectId } from "@/lib/validation/common";
import { getStudent, updateStudent, archiveStudent } from "@/services/student.service";

const paramsSchema = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ user, params }) => ok({ student: await getStudent(params.id, user) }),
  { auth: true, paramsSchema },
);

export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ student: await updateStudent(params.id, body, user) }),
  { auth: true, paramsSchema, bodySchema: updateStudentProfileSchema },
);

export const DELETE = routeHandler(
  async ({ user, params }) => ok(await archiveStudent(params.id, user)),
  { auth: true, paramsSchema },
);
