import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { pendingVerificationQueue } from "@/services/verification.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await pendingVerificationQueue(query);
    return ok({ records: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.ADMIN_VERIFICATION_MANAGE,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
);
