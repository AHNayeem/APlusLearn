import "server-only";
import { Settings } from "@/models";
import { DEFAULT_SETTINGS } from "@/constants";
import { toPlain, compact } from "@/lib/utils/serialize";

/**
 * Platform settings are a singleton document. Business rules read them on
 * every decision, so the value is memoised for a short window rather than
 * re-fetched per call (§20, §26).
 */

const CACHE_TTL_MS = 30_000;
const globalForSettings = globalThis;
const cache = globalForSettings.__aplusSettings ?? { value: null, expiresAt: 0 };
globalForSettings.__aplusSettings = cache;

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache.value && cache.expiresAt > Date.now()) return cache.value;

  let doc = await Settings.findOne({ key: "PLATFORM" }).lean();
  if (!doc) {
    doc = (await Settings.create({ key: "PLATFORM", ...DEFAULT_SETTINGS })).toObject();
  }

  const value = { ...DEFAULT_SETTINGS, ...toPlain(doc) };
  cache.value = value;
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
  return value;
}

export async function updateSettings(patch, adminId) {
  const updated = await Settings.findOneAndUpdate(
    { key: "PLATFORM" },
    { $set: { ...compact(patch), updatedBy: adminId } },
    { returnDocument: "after", upsert: true, runValidators: true },
  ).lean();

  cache.value = null;
  cache.expiresAt = 0;
  return toPlain(updated);
}

export function invalidateSettingsCache() {
  cache.value = null;
  cache.expiresAt = 0;
}
