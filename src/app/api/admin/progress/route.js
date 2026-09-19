import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { adminReportQuerySchema } from "@/lib/validation/progress";
import { listAllProgressReports } from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

/** Shared reports, for support. Drafts are excluded — see the service. */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listAllProgressReports(query);
    return ok({ reports: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_PROGRESS_VIEW, querySchema: adminReportQuerySchema },
);
