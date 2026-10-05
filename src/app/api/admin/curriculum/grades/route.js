import { z } from "zod";
import { routeHandler, ok, created } from "@/lib/api";
import { gradeSchema } from "@/lib/validation/admin";
import { provinceCode } from "@/lib/validation/common";
import { createGrade, listGrades } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

/** Every grade of a province, deactivated ones included (the admin view). */
export const GET = routeHandler(
  async ({ query }) => ok({ grades: await listGrades({ provinceCode: query.province, activeOnly: false }) }),
  {
    permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE,
    querySchema: z.object({ province: provinceCode }),
  },
);

export const POST = routeHandler(
  async ({ user, body }) => created({ grade: await createGrade(body, user) }),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, bodySchema: gradeSchema },
);
