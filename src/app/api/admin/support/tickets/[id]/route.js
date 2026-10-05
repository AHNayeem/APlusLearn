import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { supportTicketUpdateSchema } from "@/lib/validation/admin";
import { objectId } from "@/lib/validation/common";
import { getSupportTicket, updateSupportTicket } from "@/services/support.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ params }) => ok({ ticket: await getSupportTicket(params.id) }),
  { permission: PERMISSIONS.ADMIN_SUPPORT_MANAGE, paramsSchema },
);

/**
 * Change a ticket's status, add an internal note, or both. The allowed moves
 * and the race between two administrators are settled in the service; every
 * change is audited there.
 */
export const PATCH = routeHandler(
  async ({ params, body, user, request }) =>
    ok({ ticket: await updateSupportTicket(params.id, body, user, { request }) }),
  { permission: PERMISSIONS.ADMIN_SUPPORT_MANAGE, paramsSchema, bodySchema: supportTicketUpdateSchema },
);
