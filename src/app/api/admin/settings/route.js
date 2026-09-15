import { routeHandler, ok } from "@/lib/api";
import { platformSettingsSchema } from "@/lib/validation/admin";
import { getSettings, updateSettings } from "@/services/settings.service";
import { recordAudit } from "@/services/audit.service";
import { AUDIT_ACTIONS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async () => ok({ settings: await getSettings({ fresh: true }) }),
  { permission: PERMISSIONS.ADMIN_SETTINGS_MANAGE },
);

/** Commission and cancellation rules take effect on the next calculation. */
export const PATCH = routeHandler(
  async ({ user, body }) => {
    const settings = await updateSettings(body, user.id);
    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "Settings",
      metadata: body,
    });
    return ok({ settings });
  },
  { permission: PERMISSIONS.ADMIN_SETTINGS_MANAGE, bodySchema: platformSettingsSchema },
);
