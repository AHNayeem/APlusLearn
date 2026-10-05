import { z } from "zod";
import { routeHandler, ok, failFromError } from "@/lib/api";
import { connectToDatabase } from "@/lib/db/connect";
import { objectId } from "@/lib/validation/common";
import { capturePayment, requireInAppCheckout } from "@/services/payment.service";
import { confirmBookings } from "@/services/booking.service";
import { PERMISSIONS } from "@/constants";

/**
 * Complete checkout and confirm the booking(s).
 *
 * Card details are forwarded to the payment provider and never persisted —
 * only the brand and last four digits come back (§20, §35).
 */
const capture = routeHandler(
  async ({ user, params, body }) => {
    const payment = await capturePayment(params.id, { card: body.card }, user);
    // No meeting provider is taken from the request: the platform the
    // purchaser chose was recorded on the booking when it was created, and
    // that is what the room is built on (§27, §42).
    const result = await confirmBookings(params.id);
    return ok({ payment, ...result });
  },
  {
    permission: PERMISSIONS.BOOKING_CREATE,
    verifiedEmail: true,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: z.object({
      card: z.object({
        number: z.string().min(12).max(24),
        name: z.string().trim().min(2).max(80),
        expiry: z.string().regex(/^\d{2}\s?\/\s?\d{2}$/, "Use MM/YY."),
        cvc: z.string().regex(/^\d{3,4}$/, "Enter the 3 or 4 digit code."),
        postalCode: z.string().trim().max(10).optional(),
      }),
    }),
  },
);

/**
 * With hosted checkout the card form is the provider's, and this route has
 * nothing to accept — so it answers 404 before the body is read, rather than
 * parsing a card number only to refuse it (S16).
 */
export async function POST(request, context) {
  try {
    await connectToDatabase();
    await requireInAppCheckout();
  } catch (error) {
    return failFromError(error);
  }
  return capture(request, context);
}
