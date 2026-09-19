import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { ownerReportQuerySchema } from "@/lib/validation/progress";
import { listReportsForOwner } from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

/** A family's progress history. Drafts never appear here (§41 Phase 2). */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, unread, page, pageSize } = await listReportsForOwner(user, query);
    return ok({ reports: items, unread }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.PROGRESS_REPORT_VIEW, querySchema: ownerReportQuerySchema },
);
