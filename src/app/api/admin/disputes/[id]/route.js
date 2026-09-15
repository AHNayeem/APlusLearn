import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { resolveDisputeSchema } from "@/lib/validation/bookings";
import { objectId } from "@/lib/validation/common";
import { resolveDispute, addDisputeNote } from "@/services/dispute.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

/** Record an internal note without resolving. */
export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ dispute: await addDisputeNote(params.id, body.note, user) }),
  {
    permission: PERMISSIONS.ADMIN_DISPUTE_MANAGE,
    paramsSchema,
    bodySchema: z.object({ note: z.string().trim().min(3).max(1500) }),
  },
);

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ dispute: await resolveDispute(params.id, body, user) }),
  { permission: PERMISSIONS.ADMIN_DISPUTE_MANAGE, paramsSchema, bodySchema: resolveDisputeSchema },
);
