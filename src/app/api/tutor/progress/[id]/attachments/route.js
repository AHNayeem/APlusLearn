import { z } from "zod";
import { routeHandler, created, ValidationError } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { addHomeworkAttachments } from "@/services/progress.service";
import { attachmentsFromForm, ATTACHMENT_LIMITS } from "@/services/attachment.service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { PERMISSIONS } from "@/constants";

/**
 * Attach the worksheet to a report's homework (§41 Phase 3).
 *
 * `PROGRESS_REPORT_WRITE` opens the door; it does not say *which* report.
 * Authorship is checked in the service against the loaded record, so a tutor
 * holding this permission can only ever reach reports they wrote — the same
 * split `BOOKING_MEETING_MANAGE` makes between a right and a target.
 */
export const POST = routeHandler(
  async ({ request, user, params }) => {
    const form = await request.formData();
    const files = attachmentsFromForm(form);

    if (!files.length) {
      throw new ValidationError({ fieldErrors: { file: ["Choose a file to attach."] } });
    }

    await enforceRateLimit(`progress-attachment:${user.id}`, {
      limit: ATTACHMENT_LIMITS.maxPerReport * 4,
      windowMs: 10 * 60_000,
    });

    return created(await addHomeworkAttachments(params.id, files, user));
  },
  {
    permission: PERMISSIONS.PROGRESS_REPORT_WRITE,
    paramsSchema: z.object({ id: objectId }),
  },
);
