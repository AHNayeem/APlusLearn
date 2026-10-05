import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { getCurriculumTree } from "@/services/curriculum.service";
import { provinceCode } from "@/lib/validation/common";

/**
 * Province + grades + subjects in one call, for curriculum pickers. Without
 * a province the default comes from the data (the first live province).
 */
export const GET = routeHandler(
  async ({ query }) => ok(await getCurriculumTree(query.province)),
  { querySchema: z.object({ province: provinceCode.optional() }) },
);
