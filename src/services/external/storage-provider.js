import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { requireIntegration, DEVELOPMENT } from "@/lib/config/env";
import { S3Client, storageError } from "./s3-storage";

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
 *   LocalStorageProvider — development. Writes under `.storage/`.
 *   S3StorageProvider    — any real deployment. Speaks S3 directly, so it
 *                          runs against S3, R2, B2, Spaces or MinIO.
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
 *   remove({ storageKey, scope })  → { removed: boolean }
 *
 * `storageKey` is generated here and is opaque to the caller. It is never
 * derived from the uploader's filename, never guessable from anything the
 * caller can see, and never a URL: there is no code path in this application
 * that hands a storage location to a browser. Both scopes are read back
 * through a route that has already decided the caller may have the bytes —
 * an admin for a verification document, anyone for a branding asset the
 * settings document points at.
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
  async remove() {
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

  async remove({ storageKey, scope = STORAGE_SCOPES.DOCUMENTS }) {
    await unlink(path.join(scopedDir(scope), safeKey(storageKey))).catch(() => {});
    return { removed: true };
  }
}

/**
 * Object storage, for any deployment whose filesystem is not durable (§16, §38).
 *
 * This is the provider a real deployment runs on. A serverless host gives each
 * invocation its own ephemeral disk, so the local provider above loses a
 * tutor's identity paperwork somewhere between the upload and the
 * administrator opening it — which is a broken verification workflow and a
 * poor way to treat identity documents besides.
 *
 * Privacy is by construction rather than by configuration:
 *
 *   - the bucket is never required to be public, and nothing here sets an
 *     ACL, so it inherits the account's private default;
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
export class S3StorageProvider extends StorageProvider {
  constructor({ prefix = "", ...options } = {}) {
    super();
    this.client = new S3Client(options);
    this.prefix = prefix.replace(/^\/+|\/+$/g, "");
  }

  get name() {
    return "S3";
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
export function getStorageProvider() {
  const { name } = requireIntegration("storage");
  if (cached?.key === name) return cached.provider;

  const provider =
    name === "s3"
      ? new S3StorageProvider({
          bucket: process.env.S3_BUCKET,
          region: process.env.S3_REGION || "us-east-1",
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          sessionToken: process.env.S3_SESSION_TOKEN || undefined,
          endpoint: process.env.S3_ENDPOINT || undefined,
          // Path style works everywhere; virtual-hosted style is opt-in.
          forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
          prefix: process.env.S3_PREFIX || "",
        })
      : new LocalStorageProvider();

  cached = { key: name, provider };
  return provider;
}

/** Tests and the admin health panel; never reached by a request. */
export function resetStorageProvider() {
  cached = null;
}

export { storageError, DEVELOPMENT };
