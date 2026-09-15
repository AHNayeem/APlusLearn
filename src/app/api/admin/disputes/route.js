import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listDisputes } from "@/services/dispute.service";
import { DISPUTE_STATUS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listDisputes(user, query);
    return ok({ disputes: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.ADMIN_DISPUTE_MANAGE,
    querySchema: z.object({
      status: z.enum(Object.values(DISPUTE_STATUS)).optional(),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);
