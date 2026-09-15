import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";

/**
 * Verification document storage (§16, §35).
 *
 * Documents are private: they are written outside `public/` and only ever
 * streamed back through an admin-authorised route. The storage key is
 * `select: false` on the model so it cannot leak through a serialised
 * document.
 */

/**
 * Every path below is spelled out with string literals rather than built from
 * a variable, so the bundler scopes filesystem tracing to this one directory
 * instead of pulling the whole project into the server bundle.
 */
function storageDir() {
  return path.join(process.cwd(), ".storage", "documents");
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

  async put({ buffer, fileName, contentType }) {
    await mkdir(storageDir(), { recursive: true });
    const key = `${randomUUID()}${path.extname(fileName) || ""}`;
    await writeFile(path.join(process.cwd(), ".storage", "documents", key), buffer);
    return {
      storageKey: key,
      contentType,
      sizeBytes: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  async get({ storageKey }) {
    // Refuse any key that tries to escape the storage root.
    const safe = path.basename(String(storageKey));
    return readFile(path.join(process.cwd(), ".storage", "documents", safe));
  }

  async remove({ storageKey }) {
    const safe = path.basename(String(storageKey));
    await unlink(path.join(process.cwd(), ".storage", "documents", safe)).catch(() => {});
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
