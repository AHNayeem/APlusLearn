import { routeHandler, ok } from "@/lib/api";
import { notificationPreferencesSchema } from "@/lib/validation/users";
import { updateNotificationPreferences } from "@/services/user.service";

export const PATCH = routeHandler(
  async ({ user, body }) =>
    ok({ notificationPreferences: await updateNotificationPreferences(user.id, body) }),
  { auth: true, bodySchema: notificationPreferencesSchema },
);
