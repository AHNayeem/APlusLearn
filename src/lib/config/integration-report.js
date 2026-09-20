import "server-only";
import { Integration } from "@/models";
import {
  INTEGRATION_REGISTRY,
  INTEGRATION_MODULE_KEYS,
  FIELD_KINDS,
  fieldsFor,
} from "@/constants/integrations";

/**
 * What the stored integration configuration looks like, without reading any
 * of it (§36).
 *
 * Kept apart from `resolveIntegrationConfig` on purpose. That function
 * decrypts, so it pulls in `node:crypto`, and the start-up hook is traced for
 * the Edge runtime as well as Node — importing it there is both a bundler
 * warning and a bad idea. More to the point, a boot report has no business
 * holding a plaintext credential: "is the Stripe key set" is a different and
 * much duller question than "what is the Stripe key", and this module can
 * only ask the duller one.
 *
 * Completeness is judged from `secretMeta.set` rather than from the
 * ciphertext, which is exactly the fact the panel itself displays.
 */
export async function integrationBootReport() {
  const records = await Integration.find({})
    .select("module enabled provider providers config secretMeta updatedAt")
    .lean();

  const byModule = new Map(records.map((record) => [record.module, record]));

  return INTEGRATION_MODULE_KEYS.filter((key) => byModule.has(key)).map((key) => {
    const record = byModule.get(key);
    const registry = INTEGRATION_REGISTRY[key];
    const providers = registry.multi
      ? (record.providers ?? [])
      : [record.provider].filter(Boolean);

    const missing = providers.flatMap((provider) =>
      fieldsFor(key, provider)
        .filter((field) => field.required)
        .filter((field) =>
          field.kind === FIELD_KINDS.SECRET
            ? !record.secretMeta?.[field.name]?.set
            : isBlank(record.config?.[field.name]),
        )
        .map((field) => field.label),
    );

    return {
      module: key,
      label: registry.label,
      enabled: record.enabled !== false,
      provider: providers.join(" + ") || null,
      configured: providers.length > 0 && missing.length === 0,
      missing: [...new Set(missing)],
      updatedAt: record.updatedAt ?? null,
    };
  });
}

function isBlank(value) {
  return value === undefined || value === null || value === "";
}
