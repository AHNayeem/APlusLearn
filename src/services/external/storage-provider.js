import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import {
  IntegrationDisabledError,
  resolveIntegrationConfig,
} from "@/lib/config/integrations";
import { ConfigurationError } from "@/lib/config/env";
import { INTEGRATION_MODULES, UPLOAD } from "@/constants";
import { ObjectStoreClient, storageError } from "./object-storage";

/**
 * Private file storage (§16, §35, §26).
 *
 * Three scopes, with different audiences and the same handling:
 *
 *   documents — verification paperwork. Private: written outside `public/`,
 *               streamed back only through an admin-authorised route, and the
 *               storage key is `select: false` on the model so it cannot leak
 *               through a serialised document.
 *   branding  — logos and icons an administrator uploaded. Public *content*,
 *               but still not public *files*: they are served through a route
 *               that names them from the settings document, so a raw key can
 *               never be guessed at, enumerated, or used to host something
 *               that was never meant to be on this domain.
 *   avatars   — profile photos people uploaded of themselves. Served through
 *               a route that resolves the key back to the account currently
 *               holding it, so only a key that *is* somebody's avatar right
 *               now can be read, and a document key can never be one (§8).
 *
 * The separation is what makes that last sentence true: the scope decides the
 * folder, so a key lifted from one scope addresses nothing in another.
 *
 * Nothing is written into `public/`. A writable directory inside the served
 * web root is how an upload feature becomes a remote-code-execution feature.
 *
 * Two implementations and one rule for choosing between them:
 *
 *   ObjectStorageProvider  — used whenever an S3-compatible endpoint, bucket,
 *                            access key and secret key are all available.
 *                            Speaks the S3 API directly, so MinIO, S3, R2, B2
 *                            and Spaces differ only by endpoint.
 *   LocalStorageProvider   — used whenever any one of those four is missing.
 *                            Writes under `.storage/` (`STORAGE_LOCAL_DIR`).
 *
 * `describeStorageMode()` is that rule, and it is the only place it is
 * written down. Nothing else in the application — no route, no service, no
 * component — reads a STORAGE_* variable or asks which mode is live in order
 * to decide what to do; they call `getStorageProvider()` and use the
 * interface. Both modes accept the same uploads, return the same
 * `{ storageKey, contentType, sizeBytes, checksum }`, and store the same
 * provider-independent key in the database, so a deployment can move between
 * them without touching a single stored document.
 *
 * The fallback is deliberate and it is not free. A host with an ephemeral
 * filesystem accepts a tutor's identity document into local mode and then
 * loses it on the next deploy, so local mode logs a warning on selection —
 * loudly in production — and a deployment that would rather fail than fall
 * back sets `STORAGE_REQUIRE_EXTERNAL=true`.
 */

export const STORAGE_SCOPES = {
  DOCUMENTS: "documents",
  BRANDING: "branding",
  AVATARS: "avatars",
};

/**
 * Scope -> folder, in one place.
 *
 * A scope is always chosen by this application, never by a caller, and an
 * unrecognised one falls back to `documents` — the most restricted of the
 * three — so a typo can only ever be *more* private, never less. The mapping
 * is a table rather than a ternary because there are now three of them and a
 * fourth must not be able to silently land in somebody else's folder.
 */
const SCOPE_FOLDERS = {
  [STORAGE_SCOPES.BRANDING]: "branding",
  [STORAGE_SCOPES.AVATARS]: "avatars",
  [STORAGE_SCOPES.DOCUMENTS]: "documents",
};

function folderFor(scope) {
  return SCOPE_FOLDERS[scope] ?? SCOPE_FOLDERS[STORAGE_SCOPES.DOCUMENTS];
}

/**
 * Where local mode writes.
 *
 * `.storage/` by default — outside `public/`, outside `src/`, and already
 * ignored by git, so an uploaded file can neither be served directly nor
 * committed. `STORAGE_LOCAL_DIR` moves it (to a mounted volume, say, or to a
 * per-worker directory in a test), relative paths resolving against the
 * project root. It is a *location*, never a key: nothing a client sends can
 * reach this value, and this value never reaches a client.
 */
export function localStorageRoot() {
  const configured = process.env.STORAGE_LOCAL_DIR?.trim();
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.join(process.cwd(), UPLOAD.localStorageDir);
}

/** The scope directories. The scope is ours; it is never caller-supplied. */
function scopedDir(scope) {
  return path.join(localStorageRoot(), folderFor(scope));
}

/**
 * What a stored key is allowed to look like.
 *
 * Every key this application writes is `<uuid><ext>`, so the shape is known
 * exactly rather than guessed at. Anything else — a separator, a `..`, a
 * percent-escape, a NUL, a leading dot, an absurd length — is not a key this
 * store ever issued, and is refused rather than interpreted.
 */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Reduce a stored key to a bare object name, or refuse it.
 *
 * Two steps, and both matter. Directory components are dropped first, so a
 * key that has somehow acquired a path addresses an object of that name
 * inside our own scope and nothing outside it — the historical behaviour,
 * which the object store relies on. What survives is then checked against the
 * shape above, so a key that flattens to something that is still not a name
 * (`..`, an empty string, a Windows-style path) is rejected outright instead
 * of being handed to the filesystem or signed into a request.
 */
function safeKey(storageKey) {
  const flattened = String(storageKey ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();

  if (!KEY_PATTERN.test(flattened ?? "")) {
    throw storageError("That is not a valid storage key.", 400);
  }
  return flattened;
}

/**
 * The contract every implementation keeps.
 *
 *   put({ buffer, fileName, contentType, extension, scope })
 *       → { storageKey, contentType, sizeBytes, checksum }
 *   get({ storageKey, scope })     → Buffer
 *   head({ storageKey, scope })    → { sizeBytes, contentType, … } | null
 *   remove({ storageKey, scope })  → { removed: boolean }
 *   verify()                       → { ok, provider, detail }
 *
 * `storageKey` is generated here and is opaque to the caller. It is never
 * derived from the uploader's filename, never guessable from anything the
 * caller can see, and never a URL: there is no code path in this application
 * that hands a storage location to a browser. Both scopes are read back
 * through a route that has already decided the caller may have the bytes —
 * an admin for a verification document, anyone for a branding asset the
 * settings document points at.
 *
 * There is deliberately no presigned-URL operation. A signed link is a
 * bearer token for a file that can be forwarded, logged by a proxy and used
 * after the session that minted it has gone; streaming the bytes through a
 * route that has already authorised the caller is strictly stronger, and it
 * is the model every consumer of this interface is written against.
 */
export class StorageProvider {
  get name() {
    throw new Error("not implemented");
  }
  async put() {
    throw new Error("not implemented");
  }
  async get() {
    throw new Error("not implemented");
  }
  async head() {
    throw new Error("not implemented");
  }
  async remove() {
    throw new Error("not implemented");
  }
  /**
   * Whether an object is still there. Expressed in terms of `head` so both
   * implementations answer it the same way and neither can drift.
   */
  async exists(args) {
    return (await this.head(args)) !== null;
  }
  /** Prove the store is reachable and writable enough to serve a request. */
  async verify() {
    throw new Error("not implemented");
  }
}

/** The stored name, generated. The caller's filename is a label, not a path. */
function generateKey({ fileName, extension }) {
  return `${randomUUID()}${extension ?? path.extname(fileName ?? "") ?? ""}`;
}

export class LocalStorageProvider extends StorageProvider {
  get name() {
    return "LOCAL";
  }

  /**
   * The absolute path of one object, proved to be inside its scope.
   *
   * `safeKey` has already refused anything that is not a bare object name, so
   * this cannot resolve outside the directory. It is checked anyway: this is
   * the one function in the module that turns caller-influenced data into a
   * filesystem path, and a second, independent guard there is worth more than
   * the line it costs.
   */
  pathFor(storageKey, scope) {
    const directory = scopedDir(scope);
    const resolved = path.resolve(directory, safeKey(storageKey));
    if (resolved !== path.join(directory, path.basename(resolved))) {
      throw storageError("That is not a valid storage key.", 400);
    }
    return resolved;
  }

  async put({ buffer, fileName, contentType, extension, scope = STORAGE_SCOPES.DOCUMENTS }) {
    await mkdir(scopedDir(scope), { recursive: true });

    const key = generateKey({ fileName, extension });
    // `wx` — create, never overwrite. A UUID collision is not a realistic
    // event, but "write only if this name is free" is the property that makes
    // an upload incapable of replacing a file that is already there, and it
    // costs a flag.
    await writeFile(this.pathFor(key, scope), buffer, { flag: "wx" });

    return {
      storageKey: key,
      contentType,
      sizeBytes: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async get({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    const file = this.pathFor(storageKey, scope);
    try {
      return await readFile(file);
    } catch (error) {
      // ENOENT is "not in the store", which is what the object provider
      // reports for a missing object; the filesystem path never travels with
      // it, because the caller has no business knowing where this is kept.
      if (error?.code === "ENOENT") throw storageError("That object is not in the store.", 404);
      throw storageError("Local file storage could not read that file.", 500, error?.code);
    }
  }

  async head({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    const key = safeKey(storageKey);
    const info = await stat(this.pathFor(key, scope)).catch(() => null);
    if (!info) return null;
    return {
      key,
      sizeBytes: info.size,
      contentType: null,
      lastModified: info.mtime.toUTCString(),
      etag: null,
    };
  }

  async remove({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    // Reports what actually happened, the way the object provider does: a
    // delete of something already gone is `false`, not an error.
    try {
      await unlink(this.pathFor(storageKey, scope));
      return { removed: true };
    } catch (error) {
      if (error?.code === "ENOENT") return { removed: false };
      throw storageError("Local file storage could not delete that file.", 500, error?.code);
    }
  }

  async verify() {
    for (const scope of Object.values(STORAGE_SCOPES)) {
      await mkdir(scopedDir(scope), { recursive: true });
    }
    return {
      ok: true,
      provider: this.name,
      detail: `${path.relative(process.cwd(), localStorageRoot()) || localStorageRoot()}/ is writable`,
    };
  }
}

/**
 * Object storage, for any deployment whose filesystem is not durable (§16, §38).
 *
 * This is the provider a real deployment runs on, and it is MinIO that this
 * platform deploys against. A serverless host gives each invocation its own
 * ephemeral disk, so the local provider above loses a tutor's identity
 * paperwork somewhere between the upload and the administrator opening it —
 * which is a broken verification workflow and a poor way to treat identity
 * documents besides.
 *
 * Privacy is by construction rather than by configuration:
 *
 *   - the bucket is never required to be public, and nothing here sets an
 *     ACL, so it inherits the store's private default;
 *   - no method returns a URL. Bytes are fetched server-side and streamed
 *     through a route that has already authorised the caller, so there is no
 *     signed link to leak, expire badly, or forward;
 *   - keys are UUIDs under a scope prefix, so one cannot be guessed from a
 *     tutor's name, a document type, or another key.
 *
 * Credentials live only in this process. Nothing in the browser bundle can
 * reach this module — it is `server-only`, and the factory is called from
 * services that are too.
 */
export class ObjectStorageProvider extends StorageProvider {
  constructor({ prefix = "", label = "MINIO", ...options } = {}) {
    super();
    this.client = new ObjectStoreClient(options);
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
    this.label = label;
  }

  get name() {
    return this.label;
  }

  /** `<prefix>/<scope>/<uuid>.<ext>` — the scope is ours, never the caller's. */
  objectKey(storageKey, scope) {
    const folder = folderFor(scope);
    // `safeKey` strips any path the caller managed to get into the key, so a
    // stored value of "../../etc/passwd" addresses an object called
    // "passwd" inside our own prefix and nothing else.
    return [this.prefix, folder, safeKey(storageKey)].filter(Boolean).join("/");
  }

  async put({ buffer, fileName, contentType, extension, scope = STORAGE_SCOPES.DOCUMENTS }) {
    const storageKey = generateKey({ fileName, extension });
    await this.client.putObject(this.objectKey(storageKey, scope), buffer, { contentType });

    return {
      storageKey,
      contentType,
      sizeBytes: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async get({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    return this.client.getObject(this.objectKey(storageKey, scope));
  }

  async head({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    return this.client.headObject(this.objectKey(storageKey, scope));
  }

  async remove({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    // A delete that fails must not fail the settings write that triggered it;
    // the caller has already stopped pointing at this object.
    try {
      await this.client.deleteObject(this.objectKey(storageKey, scope));
      return { removed: true };
    } catch (error) {
      if (error.status === 404) return { removed: false };
      throw error;
    }
  }

  /**
   * Reachability, credentials and bucket, without touching an object. A
   * misconfigured store should be visible on the admin integrations panel
   * before a tutor discovers it by failing to upload their police check.
   */
  async verify() {
    await this.client.headBucket();
    return {
      ok: true,
      provider: this.name,
      detail: `bucket "${this.client.bucket}" is reachable`,
    };
  }
}

/* --- Which store is live ---------------------------------------------------- */

export const STORAGE_MODES = { EXTERNAL: "EXTERNAL", LOCAL: "LOCAL" };

/**
 * The four values an S3-compatible endpoint cannot be addressed without.
 *
 * Field name as the resolver returns it, environment variable as an operator
 * sets it, and whether it is a secret — because secrets arrive in a different
 * bag and must never be read out of the same one as the rest.
 *
 * `region` and `prefix` are deliberately absent: a store without a region uses
 * the client default (`us-east-1`, which is also MinIO's), and a store without
 * a prefix keeps its objects at the root of the bucket. Neither absence makes
 * the store unaddressable, so neither may trigger the fallback.
 */
export const REQUIRED_EXTERNAL_FIELDS = [
  { name: "endpoint", env: "STORAGE_ENDPOINT", secret: false },
  { name: "bucket", env: "STORAGE_BUCKET", secret: false },
  { name: "accessKey", env: "STORAGE_ACCESS_KEY", secret: false },
  { name: "secretKey", env: "STORAGE_SECRET_KEY", secret: true },
];

function present(value) {
  return typeof value === "string" ? value.trim() !== "" : value != null;
}

/**
 * The storage mode, decided in one place from one resolved configuration.
 *
 * This is the whole of the rule. External storage is live only when all four
 * required values are actually there — wherever they came from, the
 * environment or an operator's saved configuration, since by this point the
 * resolver has already merged the two per field. Anything missing means the
 * local filesystem, and `missing` says which, by environment variable name,
 * so the diagnostic can tell an operator what to set rather than that
 * something is wrong.
 *
 * @returns {{ mode: string, missing: string[], detail: string }}
 */
export function describeStorageMode(resolved) {
  const missing = REQUIRED_EXTERNAL_FIELDS.filter(
    (field) => !present(field.secret ? resolved?.secrets?.[field.name] : resolved?.config?.[field.name]),
  ).map((field) => field.env);

  if (missing.length) {
    // The resolver's own account of why it fell back, when it has one — an
    // explicit `STORAGE_PROVIDER=development` is a different situation from a
    // missing bucket, and reporting the second for the first would send an
    // operator to look at variables they have already set correctly.
    const reason =
      resolved?.fallbackReason ??
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`;
    return { mode: STORAGE_MODES.LOCAL, missing, reason, detail: `local filesystem — ${reason}` };
  }

  return {
    mode: STORAGE_MODES.EXTERNAL,
    missing: [],
    reason: null,
    // Endpoint, bucket and region are not secrets and are exactly what an
    // operator needs to see to recognise the store. The access key is not
    // here, and the secret key is not anywhere.
    detail: `bucket "${resolved.config.bucket}" at ${hostOf(resolved.config.endpoint)}`,
  };
}

/** Host only: a configured endpoint may carry a path, and never a credential. */
function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "the configured endpoint";
  }
}

/**
 * Build the adapter one resolved configuration describes.
 *
 * Exported so the connection test can reach a bucket an operator has just
 * described but not yet switched on.
 */
export function buildStorageProvider(resolved) {
  if (describeStorageMode(resolved).mode === STORAGE_MODES.LOCAL) return new LocalStorageProvider();

  return new ObjectStorageProvider({
    label: "MINIO",
    bucket: resolved.config.bucket,
    // Optional: absent means the client's own default, not a failure.
    region: resolved.config.region || undefined,
    accessKeyId: resolved.config.accessKey,
    secretAccessKey: resolved.secrets.secretKey,
    sessionToken: process.env.STORAGE_SESSION_TOKEN || undefined,
    endpoint: resolved.config.endpoint || undefined,
    // Path style is what MinIO serves, and works everywhere; virtual-hosted
    // style is opt-in for buckets that require it.
    forcePathStyle: resolved.config.forcePathStyle !== false,
    // Optional: absent means objects sit at the root of the bucket.
    prefix: resolved.config.prefix || "",
    // Off unless asked for: MinIO refuses per-object SSE without a KMS. Left
    // in the environment deliberately — it is a property of the bucket's
    // deployment, not a preference, and getting it wrong makes every write
    // fail rather than mis-save.
    serverSideEncryption: process.env.STORAGE_SSE || null,
    timeoutMs: Number(process.env.STORAGE_TIMEOUT_MS) || undefined,
  });
}

/* --- The factory ------------------------------------------------------------ */

let cached = null;

/**
 * Resolve the storage module, applying the two rules that are not the mode.
 *
 * `enabled: false` still refuses a *write*: an operator switching storage off
 * means new uploads stop, and falling back to the local disk instead would
 * quietly do the thing they turned off. Reads are never refused for that
 * reason — breaking retrieval of a tutor's identity documents is an incident,
 * not a setting (§39).
 *
 * A configuration that is *broken* rather than *absent* still throws, in both
 * directions. A stored secret that will not decrypt, or a provider name this
 * build does not know, is an operator's mistake with a real fix; falling back
 * to the local disk there would split one deployment's files across two stores
 * and look like it had worked.
 */
async function resolveStorage({ forWrite }) {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.STORAGE);

  if (forWrite && !resolved.enabled) throw new IntegrationDisabledError(resolved.label);

  if (!resolved.configured && resolved.code && resolved.code !== "INCOMPLETE") {
    throw new ConfigurationError(resolved.error ?? `${resolved.label} is not configured.`);
  }

  // A deployment may insist on the external store rather than accept the
  // fallback — for a host whose filesystem does not survive a deploy, losing
  // an upload is worse than refusing one.
  const mode = describeStorageMode(resolved);
  if (mode.mode === STORAGE_MODES.LOCAL && requireExternalStorage()) {
    throw new ConfigurationError(
      `File storage: STORAGE_REQUIRE_EXTERNAL is set, so the local filesystem fallback is refused. Set ${mode.missing.join(", ")}.`,
    );
  }

  return resolved;
}

function requireExternalStorage() {
  const value = process.env.STORAGE_REQUIRE_EXTERNAL?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * The store, for writing.
 *
 * Never throws because storage is *unconfigured* — that is the fallback's
 * whole purpose. It throws when the module is switched off, when a stored
 * credential is unreadable, or when this deployment has said it will not
 * accept the fallback.
 */
export async function getStorageProvider() {
  return fromResolved(await resolveStorage({ forWrite: true }));
}

/**
 * The store, for reading only.
 *
 * Switching the storage module off stops *new* uploads. It deliberately does
 * not stop reads, because the files already stored include tutors' identity
 * documents and the platform's own logo: an operator turning a provider off
 * while they reconfigure it should not thereby break verification review and
 * every page's branding. That would be an incident, not a setting (§39).
 */
export async function getStorageProviderForRead() {
  return fromResolved(await resolveStorage({ forWrite: false }));
}

function fromResolved(resolved) {
  const mode = describeStorageMode(resolved);
  const key = [
    mode.mode,
    resolved.provider,
    resolved.source,
    resolved.updatedAt?.getTime?.() ?? 0,
    // The local root is an environment value rather than part of the resolved
    // configuration, so a test (or an operator) moving it must not be served a
    // provider still pointed at the old directory.
    mode.mode === STORAGE_MODES.LOCAL ? localStorageRoot() : mode.detail,
  ].join(":");

  if (cached?.key === key) return cached.provider;

  const provider = buildStorageProvider(resolved);
  cached = { key, provider };
  announce(mode, key);
  return provider;
}

/**
 * Say which store is live, once per selection.
 *
 * Names and locations only — never an access key, never a secret, never a
 * signed URL, none of which this module logs anywhere. Local mode in
 * production is a warning rather than an informational line, because there it
 * usually means a deployment is about to lose the files it accepts.
 */
let announced = null;

function announce(mode, key) {
  if (announced === key) return;
  announced = key;

  if (mode.mode === STORAGE_MODES.EXTERNAL) {
    console.info(`[storage] EXTERNAL — ${mode.detail}`);
    return;
  }

  const where = path.relative(process.cwd(), localStorageRoot()) || localStorageRoot();
  const message = `[storage] LOCAL — uploads are written to ${where}/ because ${mode.reason}.`;

  if (process.env.APP_ENV === "production") {
    console.warn(
      `${message} On a host with an ephemeral filesystem these files do not survive a redeploy ` +
        "and are not shared between instances. Configure object storage, or set " +
        "STORAGE_REQUIRE_EXTERNAL=true to refuse this fallback.",
    );
  } else {
    console.info(message);
  }
}

/**
 * Which store is live and why, for the admin panel, the CLI and the boot
 * report. Safe to display: it contains no credential.
 */
export async function storageDiagnostics() {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.STORAGE);
  const mode = describeStorageMode(resolved);

  return {
    mode: mode.mode,
    detail: mode.detail,
    reason: mode.reason,
    missing: mode.missing,
    enabled: resolved.enabled,
    source: resolved.source,
    requiresExternal: requireExternalStorage(),
    location:
      mode.mode === STORAGE_MODES.LOCAL
        ? path.relative(process.cwd(), localStorageRoot()) || localStorageRoot()
        : mode.detail,
  };
}

/** Tests and the admin health panel; never reached by a request. */
export function resetStorageProvider() {
  cached = null;
  announced = null;
}
