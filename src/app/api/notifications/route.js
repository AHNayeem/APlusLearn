import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { notificationQuerySchema } from "@/lib/validation/engagement";
import { listNotifications } from "@/services/notification.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, unreadCount, page, pageSize } = await listNotifications(user.id, query);
    return ok(
      { notifications: items, unreadCount },
      { meta: paginationMeta({ page, pageSize, total }) },
    );
  },
  { permission: PERMISSIONS.NOTIFICATION_VIEW, querySchema: notificationQuerySchema },
);
