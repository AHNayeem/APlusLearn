import { routeHandler, ok, NotFoundError } from "@/lib/api";
import { availabilityRulesSchema } from "@/lib/validation/bookings";
import { getAvailability, updateAvailabilityRules, getOrCreateAvailability } from "@/services/availability.service";
import { requireTutorProfile } from "@/services/tutor.service";
import { PERMISSIONS, ROLES } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => {
    const profile = await requireTutorProfile(user.id);
    const availability =
      (await getAvailability(profile.id)) ??
      (await getOrCreateAvailability(profile.id, user.id, profile.timeZone));
    return ok({ availability });
  },
  { roles: ROLES.TUTOR },
);

export const PATCH = routeHandler(
  async ({ user, body }) => ok({ availability: await updateAvailabilityRules(user.id, body) }),
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT, bodySchema: availabilityRulesSchema },
);
