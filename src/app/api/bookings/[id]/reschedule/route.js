import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { rescheduleBookingSchema } from "@/lib/validation/bookings";
import { objectId } from "@/lib/validation/common";
import { rescheduleBooking } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ booking: await rescheduleBooking(params.id, body, user) }),
  {
    permission: PERMISSIONS.BOOKING_VIEW,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: rescheduleBookingSchema,
  },
);
