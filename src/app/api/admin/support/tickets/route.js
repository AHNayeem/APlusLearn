import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { supportTicketQuerySchema } from "@/lib/validation/admin";
import { listSupportTickets } from "@/services/support.service";
import { PERMISSIONS } from "@/constants";

/**
 * The support queue (§33, R28.20). Admin-only: a ticket is somebody's own
 * words to the platform, and nothing outside this permission reads them.
 */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize, counts } = await listSupportTickets(query);
    return ok({ tickets: items, counts }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_SUPPORT_MANAGE, querySchema: supportTicketQuerySchema },
);
