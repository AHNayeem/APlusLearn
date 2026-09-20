import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { requireIntegrationConfig, resolveIntegrationConfig } from "@/lib/config/integrations";
import { ConfigurationError } from "@/lib/config/env";
import { INTEGRATION_MODULES } from "@/constants";
import { ObjectStoreClient } from "./object-storage";

/**
 * Private file storage (§16, §35, §26).
 *
 * Two scopes, with different audiences and the same handling:
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
 *
 * Nothing is written into `public/`. A writable directory inside the served
 * web root is how an upload feature becomes a remote-code-execution feature.
 *
 * Two implementations, chosen by `lib/config/env` from `STORAGE_PROVIDER`:
 *
 *   LocalStorageProvider   — development. Writes under `.storage/`.
 *   ObjectStorageProvider  — any real deployment. Speaks the S3 API directly,
 *                            against MinIO (and equally against S3, R2, B2 or
 *                            Spaces — only the endpoint changes).
 *
 * The local provider is refused when `APP_ENV=production`: a serverless
 * filesystem does not survive the request that wrote to it, so a production
 * deployment on it loses every verification document it accepts.
 */

export const STORAGE_SCOPES = { DOCUMENTS: "documents", BRANDING: "branding" };

/**
 * Every path below is spelled out with string literals rather than built from
 * a variable, so the bundler scopes filesystem tracing to these directories
 * instead of pulling the whole project into the server bundle.
 */
function scopedDir(scope) {
  return scope === STORAGE_SCOPES.BRANDING
    ? path.join(process.cwd(), ".storage", "branding")
    : path.join(process.cwd(), ".storage", "documents");
}

/** Refuse any key that tries to escape its storage root. */
function safeKey(storageKey) {
  return path.basename(String(storageKey));
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

  async put({ buffer, fileName, contentType, extension, scope = STORAGE_SCOPES.DOCUMENTS }) {
    await mkdir(scopedDir(scope), { recursive: true });

    const key = generateKey({ fileName, extension });
    await writeFile(path.join(scopedDir(scope), key), buffer);

    return {
      storageKey: key,
      contentType,
      sizeBytes: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async get({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    return readFile(path.join(scopedDir(scope), safeKey(storageKey)));
  }

  async head({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    const info = await stat(path.join(scopedDir(scope), safeKey(storageKey))).catch(() => null);
    if (!info) return null;
    return {
      key: safeKey(storageKey),
      sizeBytes: info.size,
      contentType: null,
      lastModified: info.mtime.toUTCString(),
      etag: null,
    };
  }

  async remove({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    await unlink(path.join(scopedDir(scope), safeKey(storageKey))).catch(() => {});
    return { removed: true };
  }

  async verify() {
    await mkdir(scopedDir(STORAGE_SCOPES.DOCUMENTS), { recursive: true });
    return { ok: true, provider: this.name, detail: ".storage/ is writable" };
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
    const folder = scope === STORAGE_SCOPES.BRANDING ? "branding" : "documents";
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

let cached = null;

/**
 * Pick the provider for this deployment.
 *
 * `STORAGE_PROVIDER` decides, through the same rules as every other
 * integration (`lib/config/env`): development auto-detects whichever
 * credentials are present, and production must name its provider. The local
 * filesystem is refused outright under `APP_ENV=production` — silently
 * writing identity documents to a disk that will not exist on the next
 * request is the exact failure this provider exists to prevent.
 */
/**
 * Build the adapter one resolved configuration describes.
 *
 * Exported so the connection test can reach a bucket an operator has just
 * described but not yet switched on.
 */
export function buildStorageProvider(resolved) {
  if (resolved.provider !== "minio") return new LocalStorageProvider();

  return new ObjectStorageProvider({
    label: "MINIO",
    bucket: resolved.config.bucket,
    region: resolved.config.region || "us-east-1",
    accessKeyId: resolved.config.accessKey,
    secretAccessKey: resolved.secrets.secretKey,
    sessionToken: process.env.STORAGE_SESSION_TOKEN || undefined,
    endpoint: resolved.config.endpoint || undefined,
    // Path style is what MinIO serves, and works everywhere; virtual-hosted
    // style is opt-in for buckets that require it.
    forcePathStyle: resolved.config.forcePathStyle !== false,
    prefix: resolved.config.prefix || "",
    // Off unless asked for: MinIO refuses per-object SSE without a KMS. Left
    // in the environment deliberately — it is a property of the bucket's
    // deployment, not a preference, and getting it wrong makes every write
    // fail rather than mis-save.
    serverSideEncryption: process.env.STORAGE_SSE || null,
    timeoutMs: Number(process.env.STORAGE_TIMEOUT_MS) || undefined,
  });
}

export async function getStorageProvider() {
  const resolved = await requireIntegrationConfig(INTEGRATION_MODULES.STORAGE);
  return fromResolved(resolved);
}

/**
 * The store, for reading only.
 *
 * Switching the storage module off stops *new* uploads. It deliberately does
 * not stop reads, because the files already in the bucket include tutors'
 * identity documents and the platform's own logo: an operator turning a
 * provider off while they reconfigure it should not thereby break
 * verification review and every page's branding. That would be an incident,
 * not a setting (§39).
 *
 * The configuration still has to be *valid* — a disabled module with no
 * credentials cannot serve a read either, and says so.
 */
export async function getStorageProviderForRead() {
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.STORAGE);
  if (!resolved.configured) {
    throw new ConfigurationError(resolved.error ?? "File storage is not configured.");
  }
  return fromResolved(resolved);
}

function fromResolved(resolved) {
  const key = `${resolved.provider}:${resolved.source}:${resolved.updatedAt?.getTime?.() ?? 0}`;
  if (cached?.key === key) return cached.provider;

  const provider = buildStorageProvider(resolved);
  cached = { key, provider };
  return provider;
}

/** Tests and the admin health panel; never reached by a request. */
export function resetStorageProvider() {
  cached = null;
}
