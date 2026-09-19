import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { adminRequestQuerySchema } from "@/lib/validation/engagement";
import { listAllRequests } from "@/services/request.service";
import { PERMISSIONS } from "@/constants";

/** The moderation queue for tutor requests (§23, §28). */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listAllRequests(query);
    return ok({ requests: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.ADMIN_REQUEST_MODERATE,
    querySchema: adminRequestQuerySchema,
  },
);
