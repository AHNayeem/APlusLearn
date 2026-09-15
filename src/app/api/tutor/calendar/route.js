import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { dayKey } from "@/lib/validation/common";
import { getTutorCalendar } from "@/services/availability.service";
import { requireTutorProfile } from "@/services/tutor.service";
import { ROLES } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const profile = await requireTutorProfile(user.id);
    return ok(await getTutorCalendar(profile.id, query));
  },
  {
    roles: ROLES.TUTOR,
    querySchema: z.object({
      from: dayKey.optional(),
      days: z.coerce.number().int().min(1).max(42).default(7),
    }),
  },
);
