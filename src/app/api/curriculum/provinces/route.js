import { routeHandler, ok } from "@/lib/api";
import { listProvinces } from "@/services/curriculum.service";

export const GET = routeHandler(async ({ query }) => {
  const provinces = await listProvinces({ activeOnly: query.all !== "true" });
  return ok({ provinces });
});
