import { z } from "zod";
import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { listPayouts, pendingPayoutSummary, createPayout } from "@/services/payout.service";
import { PAYOUT_STATUS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const [{ items, total, page, pageSize }, pending] = await Promise.all([
      listPayouts(user, query),
      pendingPayoutSummary(),
    ]);
    return ok({ payouts: items, pending }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.ADMIN_PAYOUT_MANAGE,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
      status: z.enum(Object.values(PAYOUT_STATUS)).optional(),
      tutorUserId: objectId.optional(),
    }),
  },
);

/** Build a payout for one tutor from their settled, held-past-hold lessons. */
export const POST = routeHandler(
  async ({ user, body }) => created({ payout: await createPayout(body.tutorUserId, user) }),
  {
    permission: PERMISSIONS.ADMIN_PAYOUT_MANAGE,
    bodySchema: z.object({ tutorUserId: objectId }),
  },
);
