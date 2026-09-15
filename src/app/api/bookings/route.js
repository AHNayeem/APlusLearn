import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { createBookingSchema, bookingListQuerySchema } from "@/lib/validation/bookings";
import { listBookings, createBooking } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listBookings(user, query);
    return ok({ bookings: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.BOOKING_VIEW, querySchema: bookingListQuerySchema },
);

/**
 * Create a booking. The response carries the payment to complete — the
 * booking is not confirmed until that payment succeeds (§19, §20).
 */
export const POST = routeHandler(
  async ({ user, body }) => created(await createBooking(body, user)),
  { permission: PERMISSIONS.BOOKING_CREATE, bodySchema: createBookingSchema },
);
