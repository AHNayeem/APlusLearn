import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getConversation, conversationBookings } from "@/services/message.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, params, query }) => {
    const [thread, bookings] = await Promise.all([
      getConversation(params.id, user, query),
      conversationBookings(params.id, user),
    ]);
    return ok({ ...thread, bookings });
  },
  {
    permission: PERMISSIONS.MESSAGE_VIEW,
    paramsSchema: z.object({ id: objectId }),
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
);
