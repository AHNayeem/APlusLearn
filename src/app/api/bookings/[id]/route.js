import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getBooking } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, params }) => ok({ booking: await getBooking(params.id, user) }),
  { permission: PERMISSIONS.BOOKING_VIEW, paramsSchema: z.object({ id: objectId }) },
);
