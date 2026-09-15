import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { courseSearchSchema } from "@/lib/validation/search";
import { listCourses } from "@/services/curriculum.service";

export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listCourses(query);
    return ok({ courses: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { querySchema: courseSearchSchema },
);
