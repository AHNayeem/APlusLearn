import { z } from "zod";
import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { disputeSchema } from "@/lib/validation/bookings";
import { listDisputes, createDispute } from "@/services/dispute.service";
import { DISPUTE_STATUS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listDisputes(user, query);
    return ok({ disputes: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    auth: true,
    querySchema: z.object({
      status: z.enum(Object.values(DISPUTE_STATUS)).optional(),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);

export const POST = routeHandler(
  async ({ user, body }) => created({ dispute: await createDispute(body, user) }),
  { permission: PERMISSIONS.DISPUTE_CREATE, bodySchema: disputeSchema },
);
