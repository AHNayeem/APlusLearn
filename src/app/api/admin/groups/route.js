import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { tutorGroupQuerySchema } from "@/lib/validation/groups";
import { listAllSessions } from "@/services/group.service";
import { PERMISSIONS } from "@/constants";

/** Every group session, for moderation and support (§41 Phase 2). */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listAllSessions(query);
    return ok({ sessions: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_BOOKING_MANAGE, querySchema: tutorGroupQuerySchema },
);
