import { routeHandler, ok } from "@/lib/api";
import { markNotificationsSchema } from "@/lib/validation/engagement";
import { markNotificationsRead, unreadNotificationCount } from "@/services/notification.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, body }) => {
    const result = await markNotificationsRead(user.id, body);
    return ok({ ...result, unreadCount: await unreadNotificationCount(user.id) });
  },
  { permission: PERMISSIONS.NOTIFICATION_VIEW, bodySchema: markNotificationsSchema },
);
