import { after } from "next/server";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { tutorSearchSchema } from "@/lib/validation/search";
import { searchTutors } from "@/services/search.service";
import { recordSearch } from "@/services/search-analytics.service";

/** Public tutor search — no authentication required (§12). */
export const GET = routeHandler(
  async ({ query, user }) => {
    const result = await searchTutors(query, { viewerId: user?.id });
    // Counted for "most searched" (R28.31) after the response is sent; the
    // results page records its own searches, which do not come through here.
    after(() => recordSearch(query, result));
    return ok(
      { tutors: result.items, resolved: result.resolved },
      { meta: paginationMeta({ page: result.page, pageSize: result.pageSize, total: result.total }) },
    );
  },
  { querySchema: tutorSearchSchema },
);
