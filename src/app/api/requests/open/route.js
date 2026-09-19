import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listOpenRequestsForTutor } from "@/services/request.service";
import { PERMISSIONS, FEATURES, REQUEST_STATUS } from "@/constants";

/** Requests a tutor is eligible to respond to. */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize, requiresApproval } = await listOpenRequestsForTutor(
      user,
      query,
    );
    return ok(
      { requests: items, requiresApproval: requiresApproval ?? false },
      { meta: paginationMeta({ page, pageSize, total }) },
    );
  },
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_RESPOND,
    querySchema: z.object({
      status: z.enum(Object.values(REQUEST_STATUS)).optional(),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);
