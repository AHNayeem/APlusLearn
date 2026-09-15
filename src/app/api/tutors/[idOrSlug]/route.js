import { z } from "zod";
import { routeHandler, ok, NotFoundError } from "@/lib/api";
import { getPublicTutorBySlug, getPublicTutorById } from "@/services/tutor.service";
import { isFavourite } from "@/services/student.service";
import { ratingBreakdown } from "@/services/review.service";

/** Public tutor profile. Accepts either the SEO slug or the id (§29). */
export const GET = routeHandler(
  async ({ params, user }) => {
    const key = params.idOrSlug;
    const tutor = /^[a-f\d]{24}$/i.test(key)
      ? await getPublicTutorById(key)
      : await getPublicTutorBySlug(key);

    if (!tutor) throw new NotFoundError("That tutor profile is not available.");

    const [breakdown, saved] = await Promise.all([
      ratingBreakdown(tutor.id),
      isFavourite(tutor.id, user?.id),
    ]);

    return ok({ tutor, ratingBreakdown: breakdown, isFavourite: saved });
  },
  { paramsSchema: z.object({ idOrSlug: z.string().min(1).max(120) }) },
);
