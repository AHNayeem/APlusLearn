import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { cancelBookingSchema } from "@/lib/validation/bookings";
import { objectId } from "@/lib/validation/common";
import { cancelBooking } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

/** Refund outcome is decided by the centralised policy, not the caller (§26). */
export const POST = routeHandler(
  async ({ user, params, body }) => ok(await cancelBooking(params.id, body, user)),
  {
    permission: PERMISSIONS.BOOKING_CANCEL,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: cancelBookingSchema,
  },
);
