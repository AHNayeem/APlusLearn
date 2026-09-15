import { routeHandler, ok } from "@/lib/api";
import { platformSettingsSchema } from "@/lib/validation/admin";
import { getSettings, updateSettings } from "@/services/settings.service";
import { BRANDING_ASSET_RULES } from "@/services/branding.service";
import { recordAudit } from "@/services/audit.service";
import { AUDIT_ACTIONS, PERMISSIONS, SETTINGS_GROUPS } from "@/constants";

export const GET = routeHandler(
  async () =>
    ok({
      settings: await getSettings({ fresh: true }),
      // The upload bounds, so the admin panel states the same limits the
      // server enforces instead of keeping its own copy.
      assetRules: BRANDING_ASSET_RULES,
    }),
  { permission: PERMISSIONS.ADMIN_SETTINGS_MANAGE },
);

/**
 * Commission and cancellation rules take effect on the next calculation;
 * branding and metadata on the next render (§18).
 */
export const PATCH = routeHandler(
  async ({ request, user, body }) => {
    const before = await getSettings({ fresh: true });
    const settings = await updateSettings(body, user.id);

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "Settings",
      request,
      metadata: changeSummary(before, body),
    });

    return ok({ settings });
  },
  { permission: PERMISSIONS.ADMIN_SETTINGS_MANAGE, bodySchema: platformSettingsSchema },
);

/**
 * What actually changed, old value beside new (§35).
 *
 * Only fields whose value moved are recorded, so the log reads as a history of
 * decisions rather than a series of identical snapshots. Everything in this
 * document is configuration — there are no credentials here to redact, because
 * secrets are never stored in settings in the first place (§36).
 */
function changeSummary(before, patch) {
  const changes = {};

  const note = (path, from, to) => {
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    changes[path] = { from: from ?? null, to: to ?? null };
  };

  for (const [key, value] of Object.entries(patch ?? {})) {
    if (SETTINGS_GROUPS.includes(key) && value && !Array.isArray(value)) {
      for (const [field, inner] of Object.entries(value)) {
        note(`${key}.${field}`, before?.[key]?.[field], inner);
      }
      continue;
    }
    note(key, before?.[key], value);
  }

  return { sections: [...new Set(Object.keys(changes).map((k) => k.split(".")[0]))], changes };
}
