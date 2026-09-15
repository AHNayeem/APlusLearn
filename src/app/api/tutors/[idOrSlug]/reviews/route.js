import { z } from "zod";
import { routeHandler, ok, paginationMeta, NotFoundError } from "@/lib/api";
import { getPublicTutorBySlug, getPublicTutorById, listTutorReviews } from "@/services/tutor.service";
import { FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ params, query }) => {
    const key = params.idOrSlug;
    const tutor = /^[a-f\d]{24}$/i.test(key)
      ? await getPublicTutorById(key)
      : await getPublicTutorBySlug(key);
    if (!tutor) throw new NotFoundError("That tutor profile is not available.");

    const { items, total, page, pageSize } = await listTutorReviews(tutor.id, query);
    return ok({ reviews: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    feature: FEATURES.REVIEWS,
    paramsSchema: z.object({ idOrSlug: z.string().min(1).max(120) }),
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(30).optional(),
    }),
  },
);
