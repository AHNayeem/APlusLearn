import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { listSubjects } from "@/services/curriculum.service";
import { boolQuery, provinceCode } from "@/lib/validation/common";

/**
 * Subjects for a picker. With `province` (and optionally `grade`) only the
 * subjects that province actually has live courses for are returned, so the
 * subject list follows the province the visitor picked (§6).
 */
export const GET = routeHandler(
  async ({ query }) => {
    const subjects = await listSubjects({
      popularOnly: query.popular === true,
      provinceCode: query.province,
      gradeSlug: query.grade,
    });
    return ok({ subjects });
  },
  {
    querySchema: z.object({
      popular: boolQuery,
      province: provinceCode.optional(),
      grade: z.string().trim().max(40).optional(),
    }),
  },
);
