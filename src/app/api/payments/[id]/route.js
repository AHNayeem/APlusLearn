import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getPayment } from "@/services/payment.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, params }) => ok({ payment: await getPayment(params.id, user) }),
  { permission: PERMISSIONS.PAYMENT_VIEW, paramsSchema: z.object({ id: objectId }) },
);
