import { z } from "zod";
import { routeHandler, ok, NotFoundError } from "@/lib/api";
import { availabilityQuerySchema } from "@/lib/validation/bookings";
import { getPublicTutorBySlug, getPublicTutorById } from "@/services/tutor.service";
import { getBookableSlots } from "@/services/availability.service";

/**
 * Bookable slots for a tutor. Public so a parent can check availability
 * before creating an account (§12, §19).
 */
export const GET = routeHandler(
  async ({ params, query }) => {
    const key = params.idOrSlug;
    const tutor = /^[a-f\d]{24}$/i.test(key)
      ? await getPublicTutorById(key)
      : await getPublicTutorBySlug(key);
    if (!tutor) throw new NotFoundError("That tutor profile is not available.");

    return ok(await getBookableSlots(tutor.id, query));
  },
  {
    paramsSchema: z.object({ idOrSlug: z.string().min(1).max(120) }),
    querySchema: availabilityQuerySchema,
  },
);
