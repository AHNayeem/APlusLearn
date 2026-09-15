import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { markConversationRead } from "@/services/message.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const POST = routeHandler(
  async ({ user, params }) => ok(await markConversationRead(params.id, user)),
  {
    feature: FEATURES.MESSAGING,
    permission: PERMISSIONS.MESSAGE_VIEW,
    paramsSchema: z.object({ id: objectId }),
  },
);
