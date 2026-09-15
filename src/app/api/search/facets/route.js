import { routeHandler, ok } from "@/lib/api";
import { tutorSearchSchema } from "@/lib/validation/search";
import { searchFacets } from "@/services/search.service";

export const GET = routeHandler(async ({ query }) => ok(await searchFacets(query)), {
  querySchema: tutorSearchSchema,
});
