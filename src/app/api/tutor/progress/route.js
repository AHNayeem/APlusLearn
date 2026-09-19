import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import {
  createProgressReportSchema,
  tutorReportQuerySchema,
} from "@/lib/validation/progress";
import { createProgressReport, listReportsForTutor } from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

/** The tutor's own reports, drafts included (§41 Phase 2). */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listReportsForTutor(user, query);
    return ok({ reports: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.PROGRESS_REPORT_WRITE, querySchema: tutorReportQuerySchema },
);

/**
 * Start a report. The lessons it covers are resolved from completed bookings
 * in the service, never taken from the request.
 */
export const POST = routeHandler(
  async ({ user, body }) => created({ report: await createProgressReport(body, user) }),
  {
    permission: PERMISSIONS.PROGRESS_REPORT_WRITE,
    verifiedEmail: true,
    bodySchema: createProgressReportSchema,
  },
);
