import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { tutorSearchSchema } from "@/lib/validation/search";
import { searchTutors } from "@/services/search.service";

/** Public tutor search — no authentication required (§12). */
export const GET = routeHandler(
  async ({ query, user }) => {
    const result = await searchTutors(query, { viewerId: user?.id });
    return ok(
      { tutors: result.items, resolved: result.resolved },
      { meta: paginationMeta({ page: result.page, pageSize: result.pageSize, total: result.total }) },
    );
  },
  { querySchema: tutorSearchSchema },
);
