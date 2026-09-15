import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import {
  blockConversation, archiveConversation, reportConversation,
} from "@/services/message.service";
import { PERMISSIONS, FEATURES } from "@/constants";

/** Block, archive and report all act on the same thread (§21). */
export const POST = routeHandler(
  async ({ user, params, body }) => {
    switch (body.action) {
      case "BLOCK":
        return ok(await blockConversation(params.id, user, true));
      case "UNBLOCK":
        return ok(await blockConversation(params.id, user, false));
      case "ARCHIVE":
        return ok(await archiveConversation(params.id, user, true));
      case "UNARCHIVE":
        return ok(await archiveConversation(params.id, user, false));
      default:
        return ok(await reportConversation(params.id, { reason: body.reason }, user));
    }
  },
  {
    feature: FEATURES.MESSAGING,
    permission: PERMISSIONS.MESSAGE_VIEW,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: z
      .object({
        action: z.enum(["BLOCK", "UNBLOCK", "ARCHIVE", "UNARCHIVE", "REPORT"]),
        reason: z.string().trim().max(600).optional(),
      })
      .refine((d) => d.action !== "REPORT" || (d.reason?.length ?? 0) >= 10, {
        message: "Tell us what happened so we can look into it.",
        path: ["reason"],
      }),
  },
);
