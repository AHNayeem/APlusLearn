import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { removeHomeworkAttachment } from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

/**
 * Take a worksheet back off a report (§41 Phase 3).
 *
 * Only the report's author, checked in the service against the stored record.
 * Removing from a report the family has already been shown snapshots a
 * revision first, so the history still says the file was there — see the
 * service for why the removal is allowed at all after submission.
 */
export const DELETE = routeHandler(
  async ({ user, params }) =>
    ok(await removeHomeworkAttachment(params.id, params.attachmentId, user)),
  {
    permission: PERMISSIONS.PROGRESS_REPORT_WRITE,
    paramsSchema: z.object({ id: objectId, attachmentId: objectId }),
  },
);
