import { routeHandler, ok } from "@/lib/api";
import { listSubjects } from "@/services/curriculum.service";

export const GET = routeHandler(async ({ query }) => {
  const subjects = await listSubjects({ popularOnly: query.popular === "true" });
  return ok({ subjects });
});
