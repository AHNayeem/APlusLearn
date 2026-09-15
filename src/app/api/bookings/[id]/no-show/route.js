import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { reportNoShowSchema } from "@/lib/validation/bookings";
import { objectId } from "@/lib/validation/common";
import { reportNoShow } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ booking: await reportNoShow(params.id, body, user) }),
  {
    permission: PERMISSIONS.BOOKING_VIEW,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: reportNoShowSchema,
  },
);
