/**
 * Object-storage operations (§16, §38).
 *
 *   bun run storage:check              prove the credentials open the bucket
 *   bun run storage:check --roundtrip  and that a file survives put/get/delete
 *   bun run storage:migrate            copy .storage/** into the bucket
 *   bun run storage:migrate --dry-run  list what would be copied
 *
 * The migration is a *copy*, deliberately. `storageKey` in the database is
 * just the object's filename — never a URL, never a bucket, never a path — so
 * moving between providers changes nothing in Mongo, and the local copy under
 * `.storage/` is left exactly where it was. Verify the bucket first, remove
 * the directory yourself afterwards.
 *
 * Reads the same STORAGE_* variables the application does, so what it proves
 * is what the application will do.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inspectDocument } from "@/lib/images/inspect";
import {
  ObjectStorageProvider,
  STORAGE_SCOPES,
} from "@/services/external/storage-provider";

const args = new Set(process.argv.slice(2));
const command = process.argv[2]?.startsWith("--") ? "check" : process.argv[2] || "check";
const dryRun = args.has("--dry-run");

/**
 * Every missing variable at once, rather than one per run. The same four
 * `lib/config/env` requires of `STORAGE_PROVIDER=minio`.
 */
function ensureConfigured() {
  const missing = [
    "STORAGE_ENDPOINT",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
  ].filter((name) => !process.env[name]?.trim());

  if (missing.length) {
    console.error(`\n✗ Not configured. Set ${missing.join(", ")} in .env.local.`);
    console.error("  See .env.example section 6 for what each one is.\n");
    process.exit(1);
  }
}

function provider() {
  return new ObjectStorageProvider({
    bucket: process.env.STORAGE_BUCKET,
    endpoint: process.env.STORAGE_ENDPOINT,
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    region: process.env.STORAGE_REGION || "us-east-1",
    sessionToken: process.env.STORAGE_SESSION_TOKEN || undefined,
    prefix: process.env.STORAGE_PREFIX || "",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
    serverSideEncryption: process.env.STORAGE_SSE || null,
  });
}

/** Never print a credential; the endpoint and bucket are not secrets. */
function describe() {
  console.log(`  endpoint   ${process.env.STORAGE_ENDPOINT}`);
  console.log(`  bucket     ${process.env.STORAGE_BUCKET}`);
  console.log(`  prefix     ${process.env.STORAGE_PREFIX || "(none)"}`);
  console.log(`  region     ${process.env.STORAGE_REGION || "us-east-1"}`);
  console.log(`  addressing ${process.env.STORAGE_FORCE_PATH_STYLE !== "false" ? "path-style" : "virtual-hosted"}`);
  console.log(`  per-object SSE ${process.env.STORAGE_SSE || "off"}`);
}

async function check() {
  ensureConfigured();
  console.log("\nMinIO connectivity\n" + "─".repeat(48));
  describe();
  const store = provider();

  try {
    await store.verify();
    console.log("\n✓ the bucket is reachable and the credentials are accepted");
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    if (error.detail) console.error(`  ${error.detail}`);
    process.exit(1);
  }

  if (!args.has("--roundtrip")) {
    console.log("  (pass --roundtrip to also write, read and delete a test object)");
    return;
  }

  const bytes = Buffer.from(`%PDF-1.4 apluslearn storage check ${randomUUID()}`);
  let stored;
  try {
    stored = await store.put({
      buffer: bytes,
      fileName: "storage-check.pdf",
      contentType: "application/pdf",
      extension: ".pdf",
    });
    console.log(`✓ wrote documents/${stored.storageKey} (${stored.sizeBytes} bytes)`);

    const readBack = await store.get({ storageKey: stored.storageKey });
    if (Buffer.compare(readBack, bytes) !== 0) throw new Error("the bytes read back do not match");
    console.log("✓ read it back byte for byte");

    const meta = await store.head({ storageKey: stored.storageKey });
    console.log(`✓ metadata: ${meta.sizeBytes} bytes, ${meta.contentType}, etag ${meta.etag}`);
  } catch (error) {
    console.error(`\n✗ ${error.message}`);
    if (error.detail) console.error(`  ${error.detail}`);
    process.exit(1);
  } finally {
    if (stored) {
      const { removed } = await store.remove({ storageKey: stored.storageKey }).catch(() => ({ removed: false }));
      console.log(removed ? "✓ deleted it again — the bucket is as you left it" : "⚠ could not delete the test object");
    }
  }
}

/**
 * Copy the local development store into the bucket, keeping every filename
 * exactly — they are the `storageKey` values the database already holds.
 * Existing objects are skipped, so the command is safe to re-run.
 */
async function migrate() {
  ensureConfigured();
  console.log(`\nMigrating .storage/ → MinIO${dryRun ? " (dry run)" : ""}\n` + "─".repeat(48));
  describe();
  const store = provider();

  await store.verify().catch((error) => {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  });

  let copied = 0;
  let skippedExisting = 0;
  let failedCount = 0;

  for (const scope of [STORAGE_SCOPES.DOCUMENTS, STORAGE_SCOPES.BRANDING]) {
    const dir = path.join(process.cwd(), ".storage", scope);
    const names = await readdir(dir).catch(() => null);
    if (!names) {
      console.log(`\n  ${scope}: nothing to copy (.storage/${scope} does not exist)`);
      continue;
    }

    console.log(`\n  ${scope}: ${names.length} file(s)`);
    for (const name of names) {
      if (name.startsWith(".")) continue;
      try {
        const existing = await store.head({ storageKey: name, scope });
        if (existing) {
          skippedExisting += 1;
          console.log(`    = ${name} (already in the bucket)`);
          continue;
        }

        const buffer = await readFile(path.join(dir, name));
        // The content type is re-derived from the bytes, exactly as the
        // upload path does, rather than guessed from the extension.
        const contentType = inspectDocument(buffer) ?? "application/octet-stream";

        if (dryRun) {
          console.log(`    + ${name} (${buffer.length} bytes, ${contentType})`);
          copied += 1;
          continue;
        }

        // Written under its existing name, not a new one: the database is
        // already pointing at this key and must keep resolving.
        //
        // This reaches past `put()` on purpose. `put()` generates the key
        // itself, and that is a property worth keeping — no application code
        // should be able to choose where a file lands. Rather than add a
        // key-naming method to the interface that a service could later
        // misuse, this one-off migration goes through the client directly.
        await store.client.putObject(store.objectKey(name, scope), buffer, { contentType });
        copied += 1;
        console.log(`    + ${name} (${buffer.length} bytes, ${contentType})`);
      } catch (error) {
        failedCount += 1;
        console.error(`    ✗ ${name}: ${error.message}`);
      }
    }
  }

  console.log(
    `\n${dryRun ? "Would copy" : "Copied"} ${copied}, skipped ${skippedExisting} already present` +
      (failedCount ? `, ${failedCount} FAILED` : ""),
  );
  if (!dryRun && copied) {
    console.log(
      "\nNothing in the database changed — `storageKey` is the filename, and the\n" +
        "filenames are unchanged. Set STORAGE_PROVIDER=minio, restart, confirm a\n" +
        "document opens in Admin → Verification, then remove .storage/ yourself.",
    );
  }
  if (failedCount) process.exitCode = 1;
}

const commands = { check, migrate };

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use: check | migrate`);
  process.exit(1);
}

await commands[command]();
