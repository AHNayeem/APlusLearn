import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { refundSchema } from "@/lib/validation/admin";
import { objectId } from "@/lib/validation/common";
import { refundPayment } from "@/services/payment.service";
import { PERMISSIONS } from "@/constants";

/** Manual refund. The service caps it at the remaining refundable balance. */
export const POST = routeHandler(
  async ({ user, params, body }) =>
    ok({
      payment: await refundPayment(params.id, {
        amountCents: body.amountCents,
        reason: body.reason,
        issuedBy: user.id,
      }),
    }),
  {
    permission: PERMISSIONS.ADMIN_PAYMENT_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: refundSchema,
  },
);
