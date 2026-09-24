import { z } from "zod";
import { routeHandler } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { readHomeworkAttachment } from "@/services/progress.service";
import { attachmentHeaders } from "@/services/attachment.service";

/**
 * Stream one homework file from a progress report (§41 Phase 3).
 *
 * Under `/api/progress` rather than `/api/tutor/progress` because the family
 * is the reader this exists for; the tutor and an administrator can read it
 * too, and which of the three is asking is decided in the service from the
 * report's own `tutorUserId` and `ownerId`. A draft's files stay with their
 * author, exactly as a draft's text does.
 */
export const GET = routeHandler(
  async ({ user, params }) => {
    const { buffer, contentType, fileName, sizeBytes } = await readHomeworkAttachment(
      params.id,
      user,
    );
    return new Response(buffer, { headers: attachmentHeaders({ contentType, fileName, sizeBytes }) });
  },
  { auth: true, paramsSchema: z.object({ id: objectId }) },
);
