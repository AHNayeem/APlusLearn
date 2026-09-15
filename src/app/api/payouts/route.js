import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listPayouts } from "@/services/payout.service";
import { PAYOUT_STATUS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listPayouts(user, query);
    return ok({ payouts: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.TUTOR_PAYOUT_MANAGE,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
      status: z.enum(Object.values(PAYOUT_STATUS)).optional(),
    }),
  },
);
