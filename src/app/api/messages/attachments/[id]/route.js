import { z } from "zod";
import { routeHandler } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { readMessageAttachment } from "@/services/message.service";
import { attachmentHeaders } from "@/services/attachment.service";

/**
 * Stream one file shared in a conversation (§21, §35).
 *
 * The path names an attachment, never a storage key — the key is
 * `select: false` and has never been outside the server. The service turns
 * the id back into the message that holds it and then asks the *conversation*
 * whether this person belongs there, so an id lifted from somebody else's
 * thread resolves to a 403 and a guessed one resolves to nothing at all.
 *
 * `auth: true` and no permission: the audience of a file is the audience of
 * the thread, which no permission in the table describes. Participation is
 * the authorization, and it is checked against the stored document.
 */
export const GET = routeHandler(
  async ({ user, params }) => {
    const { buffer, contentType, fileName, sizeBytes } = await readMessageAttachment(
      params.id,
      user,
    );
    return new Response(buffer, { headers: attachmentHeaders({ contentType, fileName, sizeBytes }) });
  },
  { auth: true, paramsSchema: z.object({ id: objectId }) },
);
