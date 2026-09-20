import "server-only";
import mongoose from "mongoose";
import { Integration } from "@/models";
import { decryptSecret } from "@/lib/security/crypto";
import { AppError } from "@/lib/api/errors";
import {
  INTEGRATION_REGISTRY,
  INTEGRATION_MODULES,
  INTEGRATION_MODULE_KEYS,
  CONFIG_SOURCES,
  FIELD_KINDS,
  fieldsFor,
  providersFor,
} from "@/constants/integrations";
import {
  INTEGRATIONS,
  DEVELOPMENT,
  isProduction,
  resolveIntegration,
  ConfigurationError,
} from "./env";

/**
 * Where an external module's live configuration actually comes from (§26, §38).
 *
 * ## Precedence
 *
 *     built-in defaults → environment variables → persisted admin config
 *
 * Each step overrides the one before it, **per field**. The environment is
 * the bootstrap: a deployment that has never opened the admin panel behaves
 * exactly as it did before this module existed, which is what makes adopting
 * it safe. Once an operator saves a module, their values win for the fields
 * they set, and the environment still answers for the fields they left blank.
 *
 * ## What precedence does not bend
 *
 *   • `fakeAllowedInProduction: false` still holds. No database row can put
 *     payments, email or file storage into development mode on a production
 *     deployment — that guard is about what the platform will tolerate, not
 *     what an operator prefers, so it is not an operator's to override.
 *
 *   • A stored secret that will not decrypt — the normal consequence of
 *     rotating `AUTH_SECRET` — puts the module into an explicit error state.
 *     It does **not** quietly fall back to the environment. A half-read
 *     configuration silently reverting to a different set of credentials is
 *     the worst failure this module could have: it would look like it worked.
 *
 *   • `enabled: false` is refused at the factory, not merely reported, so a
 *     disabled module cannot be reached by a page, a service or a cron job
 *     that forgot to check (§39).
 *
 * ## Why this is separate from `env.js`
 *
 * `env.js` stays synchronous and environment-only, because `instrumentation.js`
 * validates configuration before the first request and boot-time assertions
 * must not depend on a database round-trip succeeding. This module is the
 * asynchronous, database-aware view, and it is what every provider factory
 * now resolves through.
 */

/** Modules whose configuration may be edited by an operator. */
export { INTEGRATION_MODULES, INTEGRATION_MODULE_KEYS };

/**
 * The key-separation label these credentials are encrypted under (§36).
 *
 * Distinct from the calendar-token label, so the key that protects a Stripe
 * secret is not the key that protects a tutor's refresh token.
 */
export const SECRET_LABEL = "aplus:integration-secret";

/**
 * A module an operator has switched off.
 *
 * 503 rather than 403: the endpoint is not forbidden to the caller, the
 * capability is absent from the deployment, and a retry after the operator
 * turns it back on is the correct response.
 */
export class IntegrationDisabledError extends AppError {
  constructor(label) {
    super(`${label} is switched off for this platform.`, {
      status: 503,
      code: "MODULE_DISABLED",
    });
    this.name = "IntegrationDisabledError";
  }
}

/**
 * Stored configuration, memoised for a short window.
 *
 * Every outgoing email and every checkout resolves through here, so this must
 * not be a database round-trip per send. The same 30-second window the
 * settings service uses, on `globalThis` for the same reason — a dev-server
 * module reload must not silently start a second cache.
 */
const CACHE_TTL_MS = 30_000;
const globalForIntegrations = globalThis;
const cache = globalForIntegrations.__aplusIntegrations ?? { entries: new Map() };
globalForIntegrations.__aplusIntegrations = cache;

export function invalidateIntegrationCache(moduleKey) {
  if (moduleKey) cache.entries.delete(moduleKey);
  else cache.entries.clear();
}

/**
 * The raw stored document, secrets included.
 *
 * `+secrets` is explicit — the schema keeps that path unselected so nothing
 * else in the application can load a ciphertext by accident.
 */
async function loadRecord(moduleKey, { fresh = false } = {}) {
  if (!fresh) {
    const hit = cache.entries.get(moduleKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  // No connection means no stored configuration to read, and the environment
  // is a complete answer on its own. Checked rather than attempted, because
  // Mongoose would otherwise buffer the query for ten seconds before failing
  // — which would turn "the database is not up yet" into a ten-second stall
  // on every send, in exactly the situation where speed matters most.
  if (mongoose.connection.readyState !== 1) return null;

  let record = null;
  try {
    record = await Integration.findOne({ module: moduleKey }).select("+secrets").lean();
  } catch (error) {
    // An unreachable database must not take email or payments down on its
    // own — the environment is still a complete, valid configuration. It is
    // logged, because a persistently unreadable settings store is a real
    // problem even when the fallback holds.
    console.warn(`[integrations] could not read stored config for ${moduleKey}:`, error.message);
    return null;
  }

  cache.entries.set(moduleKey, { value: record, expiresAt: Date.now() + CACHE_TTL_MS });
  return record;
}

/** Registry defaults for one provider's fields. */
function defaultsFor(moduleKey, provider) {
  const values = {};
  for (const field of fieldsFor(moduleKey, provider)) {
    if (field.default !== undefined) values[field.name] = field.default;
  }
  return values;
}

/** The environment's answer for one provider's fields, where it has one. */
function environmentValuesFor(moduleKey, provider) {
  const values = {};
  for (const field of fieldsFor(moduleKey, provider)) {
    if (!field.env) continue;
    const raw = process.env[field.env]?.trim();
    if (!raw) continue;
    values[field.name] = coerce(field, raw);
  }
  return values;
}

/** Environment variables are strings; the registry says what they mean. */
function coerce(field, raw) {
  if (field.kind === FIELD_KINDS.BOOLEAN) return raw !== "false" && raw !== "0";
  if (field.kind === FIELD_KINDS.PORT) return Number(raw);
  return raw;
}

/** A value an operator has actually provided — blank is "not provided". */
function isSet(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Resolve one module into the shape a provider factory needs.
 *
 * The returned `secrets` are **plaintext**. Nothing that can reach a browser
 * may call this: it exists for the factories and for the connection tests,
 * and every admin-facing read goes through `integration.service` instead,
 * which never sees this object.
 *
 * @returns {Promise<{
 *   module: string, label: string, enabled: boolean, provider: string|null,
 *   providers: string[], source: string, config: object, secrets: object,
 *   configured: boolean, missing: string[], error: string|null,
 *   usesDevelopment: boolean, updatedAt: Date|null,
 * }>}
 */
export async function resolveIntegrationConfig(moduleKey, { fresh = false } = {}) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) throw new Error(`Unknown integration module "${moduleKey}".`);

  const record = await loadRecord(moduleKey, { fresh });

  // No stored document at all: behave exactly as the application did before
  // this feature existed. This is the path every current deployment takes on
  // its first request after the upgrade, so it has to be the boring one.
  if (!record) return fromEnvironmentOnly(moduleKey, registry);

  const enabled = record.enabled !== false;
  const chosen = chosenProviders(record, registry);

  // Nothing chosen and nothing in the environment. The module exists as a row
  // but has never been configured.
  if (!chosen.length) {
    const fallback = fromEnvironmentOnly(moduleKey, registry);
    return { ...fallback, enabled, source: CONFIG_SOURCES.DATABASE, updatedAt: record.updatedAt ?? null };
  }

  const primary = chosen[0];
  const config = {
    ...defaultsFor(moduleKey, primary),
    ...environmentValuesFor(moduleKey, primary),
  };
  for (const field of fieldsFor(moduleKey, primary)) {
    if (field.kind === FIELD_KINDS.SECRET) continue;
    const stored = record.config?.[field.name];
    if (isSet(stored)) config[field.name] = stored;
  }

  // Secrets: stored first, environment behind it, per field.
  const secrets = {};
  const undecryptable = [];
  for (const field of fieldsFor(moduleKey, primary)) {
    if (field.kind !== FIELD_KINDS.SECRET) continue;

    const stored = record.secrets?.[field.name];
    if (isSet(stored)) {
      const plaintext = decryptSecret(stored, SECRET_LABEL);
      if (plaintext == null) {
        undecryptable.push(field.label);
        continue;
      }
      secrets[field.name] = plaintext;
      continue;
    }

    const fromEnv = field.env ? process.env[field.env]?.trim() : null;
    if (fromEnv) secrets[field.name] = fromEnv;
  }

  if (undecryptable.length) {
    return {
      module: moduleKey,
      label: registry.label,
      enabled,
      provider: primary,
      providers: chosen,
      source: CONFIG_SOURCES.DATABASE,
      config,
      secrets: {},
      configured: false,
      missing: [],
      error:
        `${registry.label}: ${undecryptable.join(" and ")} cannot be read. ` +
        "This happens when AUTH_SECRET changes after a secret was saved — enter the value again to repair it.",
      usesDevelopment: false,
      updatedAt: record.updatedAt ?? null,
    };
  }

  // A production deployment must not be able to run a fake for the modules
  // that move money, carry security mail or hold identity documents — no
  // matter what the database says.
  const envSpec = INTEGRATIONS[moduleKey];
  if (
    isProduction() &&
    envSpec &&
    !envSpec.fakeAllowedInProduction &&
    primary === DEVELOPMENT
  ) {
    return failed(moduleKey, registry, enabled, `${registry.label} cannot run its development provider when APP_ENV=production.`);
  }

  const missing = fieldsFor(moduleKey, primary)
    .filter((field) => field.required)
    .filter((field) => !isSet(field.kind === FIELD_KINDS.SECRET ? secrets[field.name] : config[field.name]))
    .map((field) => field.label);

  return {
    module: moduleKey,
    label: registry.label,
    enabled,
    provider: primary,
    providers: chosen,
    source: CONFIG_SOURCES.DATABASE,
    config,
    secrets,
    configured: missing.length === 0,
    missing,
    error: missing.length
      ? `${registry.label}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`
      : null,
    usesDevelopment: false,
    updatedAt: record.updatedAt ?? null,
  };
}

/** Which adapters the stored record asks for, falling back to the environment. */
function chosenProviders(record, registry) {
  if (registry.multi) {
    const listed = (record.providers ?? []).filter((name) => registry.providers[name]);
    if (listed.length) return listed;
  }
  if (record.provider && registry.providers[record.provider]) return [record.provider];
  if (record.provider === DEVELOPMENT) return [DEVELOPMENT];

  // Nothing stored — take whatever the environment resolved to, so a saved
  // `enabled` flag alone does not wipe a working environment configuration.
  const resolved = resolveIntegration(record.module);
  return resolved.configured && resolved.name !== DEVELOPMENT ? resolved.names : [];
}

/**
 * The pre-existing behaviour, expressed in the new shape.
 *
 * Delegates to the synchronous resolver so there is exactly one description
 * of what the environment means — this module adds a layer, it does not
 * reimplement the one beneath it.
 */
function fromEnvironmentOnly(moduleKey, registry) {
  const resolved = resolveIntegration(moduleKey);
  const primary = resolved.names[0] ?? resolved.name;
  const usesDevelopment = primary === DEVELOPMENT || !resolved.configured;

  const config = usesDevelopment
    ? {}
    : { ...defaultsFor(moduleKey, primary), ...environmentValuesFor(moduleKey, primary) };

  const secrets = {};
  if (!usesDevelopment) {
    for (const field of fieldsFor(moduleKey, primary)) {
      if (field.kind !== FIELD_KINDS.SECRET || !field.env) continue;
      const raw = process.env[field.env]?.trim();
      if (raw) secrets[field.name] = raw;
    }
  }

  return {
    module: moduleKey,
    label: registry.label,
    // An environment-configured deployment is on. Requiring an operator to
    // visit a screen they have never seen before email starts working again
    // would make this feature an outage.
    enabled: true,
    provider: primary === DEVELOPMENT ? DEVELOPMENT : primary,
    providers: resolved.names,
    source: usesDevelopment ? CONFIG_SOURCES.DEFAULT : CONFIG_SOURCES.ENVIRONMENT,
    config,
    secrets,
    configured: resolved.configured,
    missing: resolved.missing ?? [],
    error: resolved.error,
    usesDevelopment,
    updatedAt: null,
  };
}

function failed(moduleKey, registry, enabled, message) {
  return {
    module: moduleKey,
    label: registry.label,
    enabled,
    provider: null,
    providers: [],
    source: CONFIG_SOURCES.DATABASE,
    config: {},
    secrets: {},
    configured: false,
    missing: [],
    error: message,
    usesDevelopment: false,
    updatedAt: null,
  };
}

/**
 * The gate every provider factory calls.
 *
 * Throws rather than returning a broken configuration, so a misconfigured or
 * switched-off module fails at the point of use with a message an operator
 * can act on — instead of transacting through a fake or half-configured
 * adapter (§38, §39).
 */
export async function requireIntegrationConfig(moduleKey) {
  const resolved = await resolveIntegrationConfig(moduleKey);

  if (!resolved.enabled) throw new IntegrationDisabledError(resolved.label);
  if (!resolved.configured) throw new ConfigurationError(resolved.error ?? `${resolved.label} is not configured.`);

  return resolved;
}

/**
 * Every module's status, for the admin panel and the boot report.
 *
 * Names and states only — never a credential, not even a masked one. The
 * masked view an operator sees is built by `integration.service` from
 * `secretMeta`, which is a different and deliberately duller object.
 */
export async function integrationConfigStatus() {
  return Promise.all(
    INTEGRATION_MODULE_KEYS.map(async (moduleKey) => {
      const resolved = await resolveIntegrationConfig(moduleKey);
      return {
        module: moduleKey,
        label: resolved.label,
        enabled: resolved.enabled,
        provider: resolved.provider,
        providers: resolved.providers,
        source: resolved.source,
        configured: resolved.configured,
        usesDevelopment: resolved.usesDevelopment,
        error: resolved.error,
      };
    }),
  );
}

/** Adapters a module understands. Used by the admin form and by validation. */
export function knownProviders(moduleKey) {
  return providersFor(moduleKey);
}
