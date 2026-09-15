import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { bookingListQuerySchema } from "@/lib/validation/bookings";
import { listBookings } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

/** Every booking on the platform (§24 admin). */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listBookings(user, { ...query, scope: query.scope ?? "ALL" });
    return ok({ bookings: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_BOOKING_MANAGE, querySchema: bookingListQuerySchema },
);
