import { routeHandler, ok } from "@/lib/api";
import { unreadNotificationCount } from "@/services/notification.service";
import { unreadMessageCount } from "@/services/message.service";

/** Current session plus the counters the header and sidebars badge. */
export const GET = routeHandler(async ({ user }) => {
  if (!user) return ok({ user: null });

  const [notifications, messages] = await Promise.all([
    unreadNotificationCount(user.id),
    unreadMessageCount(user.id),
  ]);

  return ok({
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      status: user.status,
      avatarUrl: user.avatarUrl,
      emailVerified: Boolean(user.emailVerifiedAt),
    },
    unreadNotifications: notifications,
    unreadMessages: messages,
  });
});
