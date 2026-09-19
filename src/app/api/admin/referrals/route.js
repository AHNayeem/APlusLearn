import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listAllReferrals } from "@/services/referral.service";
import { PERMISSIONS, REFERRAL_STATUS } from "@/constants";

/** The referral review queue, flagged ones first (§41 Phase 2). */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, flaggedCount, page, pageSize } = await listAllReferrals(query);
    return ok({ referrals: items, flaggedCount }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.ADMIN_PAYMENT_MANAGE,
    querySchema: z.object({
      status: z.enum(Object.values(REFERRAL_STATUS)).optional(),
      flagged: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);
