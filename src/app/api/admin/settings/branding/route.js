import { z } from "zod";
import { routeHandler, ok, ValidationError } from "@/lib/api";
import { uploadBrandingAsset, removeBrandingAsset } from "@/services/branding.service";
import { recordAudit } from "@/services/audit.service";
import { AUDIT_ACTIONS, PERMISSIONS, BRANDING_ASSET_KEYS, BRANDING_ASSETS } from "@/constants";
import { readBoundedFormData } from "@/lib/security/upload-size";

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
    // The largest branding asset bounds the request before it is buffered (S19).
    const largest = Math.max(...Object.values(BRANDING_ASSETS).map((spec) => spec.maxBytes));
    const form = await readBoundedFormData(request, largest, "That file is larger than any branding asset allows.");
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
