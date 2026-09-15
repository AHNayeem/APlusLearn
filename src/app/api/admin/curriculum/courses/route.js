import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { courseSchema } from "@/lib/validation/admin";
import { courseSearchSchema } from "@/lib/validation/search";
import { listCourses, createCourse } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listCourses({ ...query, activeOnly: false });
    return ok({ courses: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, querySchema: courseSearchSchema },
);

export const POST = routeHandler(
  async ({ user, body }) => created({ course: await createCourse(body, user) }),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, bodySchema: courseSchema },
);
