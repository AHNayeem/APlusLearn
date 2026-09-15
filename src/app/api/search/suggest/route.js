import { routeHandler, ok } from "@/lib/api";
import { suggestSchema } from "@/lib/validation/search";
import { suggest } from "@/services/curriculum.service";

export const GET = routeHandler(async ({ query }) => ok(await suggest(query)), {
  querySchema: suggestSchema,
});
