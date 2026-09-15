import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";

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

export class StorageProvider {
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

class LocalStorageProvider extends StorageProvider {
  get name() {
    return "LOCAL";
  }

  async put({ buffer, fileName, contentType, extension, scope = STORAGE_SCOPES.DOCUMENTS }) {
    await mkdir(scopedDir(scope), { recursive: true });

    // The stored name is generated, never taken from the upload: the caller's
    // filename is a label, not a path.
    const key = `${randomUUID()}${extension ?? path.extname(fileName ?? "") ?? ""}`;
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

let cached;

export function getStorageProvider() {
  if (cached) return cached;
  // if (process.env.S3_BUCKET) cached = new S3StorageProvider(...)
  cached = new LocalStorageProvider();
  return cached;
}
