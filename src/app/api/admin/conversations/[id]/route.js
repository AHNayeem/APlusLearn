import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { moderateConversationSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { getReportedConversation, moderateConversation } from "@/services/message.service";
import { PERMISSIONS } from "@/constants";

/** Open a reported thread. The read itself is written to the audit log. */
export const GET = routeHandler(
  async ({ user, params }) => ok(await getReportedConversation(params.id, user)),
  {
    permission: PERMISSIONS.ADMIN_MESSAGE_MODERATE,
    paramsSchema: z.object({ id: objectId }),
  },
);

/** Record the moderator's decision. */
export const POST = routeHandler(
  async ({ user, params, body }) =>
    ok({ conversation: await moderateConversation(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_MESSAGE_MODERATE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: moderateConversationSchema,
  },
);
