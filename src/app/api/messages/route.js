import { routeHandler, created } from "@/lib/api";
import { sendMessageSchema } from "@/lib/validation/engagement";
import { sendMessage } from "@/services/message.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const POST = routeHandler(
  async ({ user, body }) => created(await sendMessage(body, user)),
  {
    feature: FEATURES.MESSAGING,
    permission: PERMISSIONS.MESSAGE_SEND,
    bodySchema: sendMessageSchema,
  },
);
