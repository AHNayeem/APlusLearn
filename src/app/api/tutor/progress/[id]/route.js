import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { updateProgressReportSchema } from "@/lib/validation/progress";
import {
  getProgressReport,
  updateProgressReport,
  submitProgressReport,
  archiveProgressReport,
} from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ user, params: p }) => ok(await getProgressReport(p.id, user)),
  { permission: PERMISSIONS.PROGRESS_REPORT_WRITE, paramsSchema: params },
);

/**
 * Edit. A draft changes in place; a shared report snapshots what it said
 * first, so the family's copy of history is not rewritten (§41 Phase 2).
 */
export const PATCH = routeHandler(
  async ({ user, params: p, body }) =>
    ok({ report: await updateProgressReport(p.id, body, user) }),
  {
    permission: PERMISSIONS.PROGRESS_REPORT_WRITE,
    paramsSchema: params,
    bodySchema: updateProgressReportSchema,
  },
);

/** Share it with the family. One way: a shared report is never un-shared. */
export const POST = routeHandler(
  async ({ user, params: p }) => ok({ report: await submitProgressReport(p.id, user) }),
  { permission: PERMISSIONS.PROGRESS_REPORT_WRITE, verifiedEmail: true, paramsSchema: params },
);

/** Archive — takes it out of the working list; the family keeps their copy. */
export const DELETE = routeHandler(
  async ({ user, params: p }) => ok({ report: await archiveProgressReport(p.id, user) }),
  { permission: PERMISSIONS.PROGRESS_REPORT_WRITE, paramsSchema: params },
);
