import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { completeBookingSchema } from "@/lib/validation/bookings";
import { objectId } from "@/lib/validation/common";
import { completeBooking } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ booking: await completeBooking(params.id, body, user) }),
  {
    permission: PERMISSIONS.BOOKING_COMPLETE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: completeBookingSchema,
  },
);
