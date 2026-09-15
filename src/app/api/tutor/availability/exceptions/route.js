import { routeHandler, created } from "@/lib/api";
import { availabilityExceptionSchema } from "@/lib/validation/bookings";
import { addException } from "@/services/availability.service";
import { PERMISSIONS } from "@/constants";

/** Block a date, an afternoon, or a vacation period (§18). */
export const POST = routeHandler(
  async ({ user, body }) => created({ availability: await addException(user.id, body) }),
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT, bodySchema: availabilityExceptionSchema },
);
