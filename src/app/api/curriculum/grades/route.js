import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { listGrades } from "@/services/curriculum.service";
import { provinceCode } from "@/lib/validation/common";

export const GET = routeHandler(
  async ({ query }) => {
    const grades = await listGrades({ provinceCode: query.province });
    return ok({ grades });
  },
  { querySchema: z.object({ province: provinceCode.optional() }) },
);
