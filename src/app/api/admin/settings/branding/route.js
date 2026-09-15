import { z } from "zod";
import { routeHandler, ok, ValidationError } from "@/lib/api";
import { uploadBrandingAsset, removeBrandingAsset } from "@/services/branding.service";
import { recordAudit } from "@/services/audit.service";
import { AUDIT_ACTIONS, PERMISSIONS, BRANDING_ASSET_KEYS } from "@/constants";

/**
 * Branding uploads (§26).
 *
 * Multipart rather than JSON, so — like the verification upload — the payload
 * is read from `FormData` instead of a body schema. The *target* is still
 * validated: only the five known asset keys are addressable, and the file
 * itself is checked from its bytes inside the service.
 */

const assetQuery = z.object({ asset: z.enum(BRANDING_ASSET_KEYS) });

export const POST = routeHandler(
  async ({ request, user, query }) => {
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      throw new ValidationError({ fieldErrors: { file: ["Choose an image to upload."] } });
    }

    const { settings, asset } = await uploadBrandingAsset({ assetKey: query.asset, file }, user);

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: "Settings",
      request,
      // The record, never the bytes: what changed, how big, what shape.
      metadata: { section: "branding", asset: query.asset, ...asset },
    });

    return ok({ settings });
  },
  { permission: PERMISSIONS.ADMIN_SETTINGS_MANAGE, querySchema: assetQuery },
);

export const DELETE = routeHandler(
  async ({ request, user, query }) => {
    const { settings, removed } = await removeBrandingAsset(query.asset, user);

    if (removed) {
      await recordAudit({
        actor: user,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        entityType: "Settings",
        request,
        metadata: { section: "branding", asset: query.asset, removed: true },
      });
    }

    return ok({ settings });
  },
  { permission: PERMISSIONS.ADMIN_SETTINGS_MANAGE, querySchema: assetQuery },
);
