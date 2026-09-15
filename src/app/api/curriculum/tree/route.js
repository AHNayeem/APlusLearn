import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { getCurriculumTree } from "@/services/curriculum.service";
import { provinceCode } from "@/lib/validation/common";

/** Province + grades + subjects in one call, for curriculum pickers. */
export const GET = routeHandler(
  async ({ query }) => ok(await getCurriculumTree(query.province ?? "ON")),
  { querySchema: z.object({ province: provinceCode.optional() }) },
);
