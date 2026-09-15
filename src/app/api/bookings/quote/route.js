import { routeHandler, ok } from "@/lib/api";
import { quoteBookingSchema } from "@/lib/validation/bookings";
import { quoteBooking } from "@/services/booking.service";

/**
 * Server-side price preview. The client displays this; it never computes a
 * total itself (§20, §42).
 */
export const POST = routeHandler(async ({ body }) => ok(await quoteBooking(body)), {
  bodySchema: quoteBookingSchema,
});
