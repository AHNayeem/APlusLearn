import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { creditStatement } from "@/services/credit.service";

/** A person's credit balance and how it got there. */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { balanceCents, entries, total, page, pageSize } = await creditStatement(user.id, query);
    return ok({ balanceCents, entries }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    auth: true,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);
