import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { capturePayment } from "@/services/payment.service";
import { confirmBookings } from "@/services/booking.service";
import { MEETING_PROVIDERS, PERMISSIONS } from "@/constants";

/**
 * Complete checkout and confirm the booking(s).
 *
 * Card details are forwarded to the payment provider and never persisted —
 * only the brand and last four digits come back (§20, §35).
 */
export const POST = routeHandler(
  async ({ user, params, body }) => {
    const payment = await capturePayment(params.id, { card: body.card }, user);
    const result = await confirmBookings(params.id, { meetingProvider: body.meetingProvider });
    return ok({ payment, ...result });
  },
  {
    permission: PERMISSIONS.BOOKING_CREATE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: z.object({
      card: z.object({
        number: z.string().min(12).max(24),
        name: z.string().trim().min(2).max(80),
        expiry: z.string().regex(/^\d{2}\s?\/\s?\d{2}$/, "Use MM/YY."),
        cvc: z.string().regex(/^\d{3,4}$/, "Enter the 3 or 4 digit code."),
        postalCode: z.string().trim().max(10).optional(),
      }),
      meetingProvider: z.enum(Object.values(MEETING_PROVIDERS)).optional(),
    }),
  },
);
