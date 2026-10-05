import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { adminApplicationQuerySchema } from "@/lib/validation/admin";
import { listApplications } from "@/services/tutor.service";
import { PERMISSIONS } from "@/constants";

/** The application queues, DRAFT included (R28.4). */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listApplications(query);
    return ok({ applications: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_TUTOR_REVIEW, querySchema: adminApplicationQuerySchema },
);
