import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getConversation, conversationBookings, messagesSince } from "@/services/message.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ user, params, query }) => {
    // A catch-up read after a realtime hint or a reconnect: only what is new,
    // and none of the thread furniture the page already has.
    if (query.since) return ok(await messagesSince(params.id, user, query.since));

    const [thread, bookings] = await Promise.all([
      getConversation(params.id, user, query),
      conversationBookings(params.id, user),
    ]);
    return ok({ ...thread, bookings });
  },
  {
    feature: FEATURES.MESSAGING,
    permission: PERMISSIONS.MESSAGE_VIEW,
    paramsSchema: z.object({ id: objectId }),
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
      since: z.coerce.date().optional(),
    }),
  },
);
