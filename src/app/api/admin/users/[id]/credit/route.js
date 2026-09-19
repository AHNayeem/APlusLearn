import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { adjustCredit, creditStatement } from "@/services/credit.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

/** One account's credit balance and statement, for support. */
export const GET = routeHandler(
  async ({ params: p }) => ok(await creditStatement(p.id, { pageSize: 25 })),
  { permission: PERMISSIONS.ADMIN_PAYMENT_MANAGE, paramsSchema: params },
);

/**
 * Move a balance by hand.
 *
 * Always audited, and always bounded: taking credit back stops at zero rather
 * than pushing an account into debt (§35, §41 Phase 2).
 */
export const POST = routeHandler(
  async ({ user, params: p, body }) => ok(await adjustCredit({ userId: p.id, ...body }, user)),
  {
    permission: PERMISSIONS.ADMIN_PAYMENT_MANAGE,
    paramsSchema: params,
    bodySchema: z.object({
      amountCents: z.coerce.number().int().min(-100000).max(100000),
      note: z.string().trim().min(5, "Record why.").max(300),
    }),
  },
);
