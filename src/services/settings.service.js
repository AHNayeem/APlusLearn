import "server-only";
import { Settings } from "@/models";
import { connectToDatabase } from "@/lib/db/connect";
import { DEFAULT_SETTINGS, SETTINGS_GROUPS, BRANDING_ASSET_KEYS } from "@/constants";
import { toPlain, compact } from "@/lib/utils/serialize";

/**
 * Platform settings are a singleton document. Business rules read them on
 * every decision, so the value is memoised for a short window rather than
 * re-fetched per call (§20, §26).
 *
 * Two readers, deliberately different:
 *
 *   getSettings()  — the strict one. Business rules use it, and if the
 *                    database is unreachable it throws, because pricing a
 *                    booking off assumed defaults is worse than failing.
 *   getAppConfig() — the presentation one. Branding, metadata and the footer
 *                    use it, and it falls back to the shipped defaults rather
 *                    than taking a page down over a logo (§19).
 */

const CACHE_TTL_MS = 30_000;
const globalForSettings = globalThis;
const cache = globalForSettings.__aplusSettings ?? { value: null, expiresAt: 0 };
globalForSettings.__aplusSettings = cache;

/**
 * Merge stored values over the defaults one level into each group, so a
 * document written before a setting existed still answers for it.
 */
function withDefaults(stored) {
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  for (const group of SETTINGS_GROUPS) {
    merged[group] = { ...DEFAULT_SETTINGS[group], ...(stored?.[group] ?? {}) };
  }
  return merged;
}

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache.value && cache.expiresAt > Date.now()) return cache.value;

  let doc = await Settings.findOne({ key: "PLATFORM" }).lean();
  if (!doc) {
    doc = (await Settings.create({ key: "PLATFORM" })).toObject();
  }

  const value = withDefaults(toPlain(doc));
  cache.value = value;
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
  return value;
}

/**
 * Nested groups arrive as partial objects. Writing them with `$set` as-is
 * would replace the whole sub-document and wipe the keys the form did not
 * send — including uploaded asset references, which no settings form touches.
 * Flattening to dotted paths makes every write a field-level update.
 */
function flattenPatch(patch) {
  const update = {};
  for (const [key, value] of Object.entries(compact(patch))) {
    if (SETTINGS_GROUPS.includes(key) && value && !Array.isArray(value)) {
      for (const [field, inner] of Object.entries(compact(value))) {
        update[`${key}.${field}`] = inner;
      }
      continue;
    }
    update[key] = value;
  }
  return update;
}

export async function updateSettings(patch, adminId) {
  const updated = await Settings.findOneAndUpdate(
    { key: "PLATFORM" },
    { $set: { ...flattenPatch(patch), updatedBy: adminId } },
    { returnDocument: "after", upsert: true, runValidators: true },
  ).lean();

  invalidateSettingsCache();
  return withDefaults(toPlain(updated));
}

/**
 * Attach or clear one uploaded branding file. Kept separate from
 * `updateSettings` because the payload is produced by the upload pipeline,
 * never by a form, and must not be settable through the JSON settings route.
 */
export async function setBrandingAsset(assetKey, asset, adminId) {
  if (!BRANDING_ASSET_KEYS.includes(assetKey)) {
    throw new Error(`Unknown branding asset "${assetKey}".`);
  }

  const updated = await Settings.findOneAndUpdate(
    { key: "PLATFORM" },
    { $set: { [`branding.${assetKey}`]: asset ?? null, updatedBy: adminId } },
    { returnDocument: "after", upsert: true, runValidators: true },
  ).lean();

  invalidateSettingsCache();
  return withDefaults(toPlain(updated));
}

export function invalidateSettingsCache() {
  cache.value = null;
  cache.expiresAt = 0;
}

/* --- Presentation view ------------------------------------------------------ */

/**
 * Where the browser fetches a branding asset. The upload timestamp is carried
 * as a cache-buster so the route can be served immutably and a replaced logo
 * still appears immediately (§18).
 */
function assetUrl(key, asset) {
  if (!asset?.storageKey) return null;
  const version = asset.uploadedAt ? Date.parse(asset.uploadedAt) || 0 : 0;
  return `/api/branding/${key}?v=${version}`;
}

/**
 * The single shape every part of the application reads branding from.
 *
 * Blank optional fields are resolved here — once — so no component has to
 * remember that "the OG title falls back to the meta title, which falls back
 * to the app name and tagline" (§19).
 */
export function resolveAppConfig(settings) {
  const s = withDefaults(settings ?? {});
  const { branding, theme, seo, contact, social, footer, features, notifications } = s;

  const appName = branding.appName || DEFAULT_SETTINGS.branding.appName;
  const tagline = branding.tagline || DEFAULT_SETTINGS.branding.tagline;
  const description = branding.description || DEFAULT_SETTINGS.branding.description;
  const title = seo.metaTitle || `${appName} — ${tagline}`;
  const metaDescription = seo.metaDescription || description;

  const assets = Object.fromEntries(
    BRANDING_ASSET_KEYS.map((key) => [key, assetUrl(key, branding[key])]),
  );

  return {
    branding: {
      appName,
      shortName: branding.shortName || appName,
      tagline,
      description,
      ...assets,
      /** The raw records, for the admin panel's preview and file details. */
      files: Object.fromEntries(BRANDING_ASSET_KEYS.map((key) => [key, branding[key] ?? null])),
    },
    theme,
    seo: {
      ...seo,
      title,
      metaDescription,
      ogTitle: seo.ogTitle || title,
      ogDescription: seo.ogDescription || metaDescription,
      ogImage: assets.ogImage,
    },
    contact,
    social,
    footer: {
      ...footer,
      description: footer.description || description,
      copyrightText:
        footer.copyrightText ||
        `© {year} ${appName}. All rights reserved. Built in Canada 🇨🇦`,
    },
    features,
    notifications,
  };
}

/**
 * Presentation config that never throws. A page render must not fail because
 * Mongo blinked, and `next build` renders pages with no database at all.
 */
export async function getAppConfig() {
  try {
    // Connects on its own: `generateMetadata` in the root layout runs before
    // any page has had a chance to, including during `next build`.
    await connectToDatabase();
    return resolveAppConfig(await getSettings());
  } catch (error) {
    console.warn("[settings] falling back to built-in branding:", error.message);
    return resolveAppConfig(null);
  }
}

/**
 * Server-side feature check. The single place a toggle is read, so the API
 * guard, a page and the navigation can never disagree about what is on.
 */
export async function isFeatureEnabled(feature) {
  try {
    const settings = await getSettings();
    return settings.features?.[feature] !== false;
  } catch {
    // An unreadable settings document must not silently switch the product
    // off — the shipped default for every flag is "on".
    return DEFAULT_SETTINGS.features[feature] ?? true;
  }
}

/** All flags at once, for layouts that pass them into client navigation. */
export async function getFeatureFlags() {
  const config = await getAppConfig();
  return config.features;
}
