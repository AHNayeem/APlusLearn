import "server-only";
import { BRANDING_ASSETS, BRANDING_ASSET_KEYS } from "@/constants";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { validateImage, extensionFor, describeTypes } from "@/lib/images/inspect";
import { getStorageProvider, STORAGE_SCOPES } from "./external/storage-provider";
import { getSettings, setBrandingAsset } from "./settings.service";

/**
 * Branding asset handling (§26 settings, §16 file handling).
 *
 * An administrator is trusted with the platform's configuration; they are not
 * trusted with its filesystem. Everything an upload claims about itself is
 * discarded and re-derived from the bytes: the format comes from the magic
 * number, the extension from the format, the stored name from a UUID. SVG is
 * refused because it is a script-capable document, not a picture.
 */

export function brandingAssetSpec(assetKey) {
  const spec = BRANDING_ASSETS[assetKey];
  if (!spec) throw new NotFoundError("That is not a branding asset.");
  return spec;
}

/** Everything the admin panel needs to describe an asset without its bytes. */
export function describeAssetRules(spec) {
  return {
    key: spec.key,
    label: spec.label,
    hint: spec.hint,
    accepts: spec.accepts,
    acceptLabel: describeTypes(spec.accepts),
    maxBytes: spec.maxBytes,
    maxKb: Math.round(spec.maxBytes / 1024),
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    maxWidth: spec.maxWidth,
    maxHeight: spec.maxHeight,
    square: Boolean(spec.square),
  };
}

export const BRANDING_ASSET_RULES = Object.fromEntries(
  BRANDING_ASSET_KEYS.map((key) => [key, describeAssetRules(BRANDING_ASSETS[key])]),
);

export async function uploadBrandingAsset({ assetKey, file }, actor) {
  const spec = brandingAssetSpec(assetKey);

  if (!file || typeof file === "string") {
    throw new ValidationError({ fieldErrors: { file: ["Choose an image to upload."] } });
  }

  // Size is checked before the bytes are read, so an oversized upload is
  // refused without being pulled into memory first.
  if (file.size > spec.maxBytes) {
    throw new BusinessRuleError(
      `${spec.label} must be smaller than ${Math.round(spec.maxBytes / 1024)} KB.`,
      "FILE_TOO_LARGE",
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const inspection = validateImage(buffer, spec);
  if (!inspection.ok) {
    throw new BusinessRuleError(inspection.reason, "UNSUPPORTED_FILE_TYPE");
  }

  const stored = await getStorageProvider().put({
    buffer,
    scope: STORAGE_SCOPES.BRANDING,
    contentType: inspection.contentType,
    extension: extensionFor(inspection.contentType),
  });

  // Replace, don't accumulate: the previous file is unreachable the moment the
  // settings document stops pointing at it.
  const previous = (await getSettings({ fresh: true })).branding?.[assetKey];

  const settings = await setBrandingAsset(
    assetKey,
    {
      storageKey: stored.storageKey,
      contentType: inspection.contentType,
      fileName: String(file.name ?? "").slice(0, 200),
      sizeBytes: stored.sizeBytes,
      width: inspection.width,
      height: inspection.height,
      uploadedAt: new Date(),
      uploadedBy: actor.id,
    },
    actor.id,
  );

  await discard(previous);

  return {
    settings,
    asset: {
      key: assetKey,
      width: inspection.width,
      height: inspection.height,
      sizeBytes: stored.sizeBytes,
      contentType: inspection.contentType,
    },
  };
}

export async function removeBrandingAsset(assetKey, actor) {
  brandingAssetSpec(assetKey);

  const previous = (await getSettings({ fresh: true })).branding?.[assetKey];
  const settings = await setBrandingAsset(assetKey, null, actor.id);
  await discard(previous);

  return { settings, removed: Boolean(previous) };
}

/** Best-effort cleanup — an orphaned file must never fail the settings write. */
async function discard(asset) {
  if (!asset?.storageKey) return;
  try {
    await getStorageProvider().remove({
      storageKey: asset.storageKey,
      scope: STORAGE_SCOPES.BRANDING,
    });
  } catch (error) {
    console.warn("[branding] could not remove replaced asset:", error.message);
  }
}

/**
 * Read one asset for public serving.
 *
 * The caller names a *setting*, never a storage key, so the only files this
 * can ever return are the five the settings document points at.
 */
export async function readBrandingAsset(assetKey) {
  brandingAssetSpec(assetKey);

  const settings = await getSettings();
  const asset = settings.branding?.[assetKey];
  if (!asset?.storageKey) throw new NotFoundError("No image is configured for that.");

  const body = await getStorageProvider().get({
    storageKey: asset.storageKey,
    scope: STORAGE_SCOPES.BRANDING,
  });

  return { body, contentType: asset.contentType, uploadedAt: asset.uploadedAt };
}
