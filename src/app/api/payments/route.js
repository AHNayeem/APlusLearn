import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listPayments } from "@/services/payment.service";
import { PAYMENT_STATUS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listPayments(user, query);
    return ok({ payments: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.PAYMENT_VIEW,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
      status: z.enum(Object.values(PAYMENT_STATUS)).optional(),
    }),
  },
);
