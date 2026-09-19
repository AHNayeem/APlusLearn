import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getProgressReport, acknowledgeProgressReport } from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ user, params: p }) => ok(await getProgressReport(p.id, user)),
  { permission: PERMISSIONS.PROGRESS_REPORT_VIEW, paramsSchema: params },
);

/**
 * The one write a family is allowed on a report: saying they have read it.
 * Nothing the tutor wrote can be changed through any route (§41 Phase 2).
 */
export const POST = routeHandler(
  async ({ user, params: p }) => ok({ report: await acknowledgeProgressReport(p.id, user) }),
  { permission: PERMISSIONS.PROGRESS_REPORT_VIEW, paramsSchema: params },
);
