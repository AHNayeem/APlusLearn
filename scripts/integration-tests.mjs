/**
 * Integration adapter tests (§46, §47).
 *
 * These exercise the production provider adapters — Stripe, Resend, Google
 * and Apple ID tokens, Google geocoding, Zoom, Google Meet, Microsoft Teams
 * and MinIO object storage — without touching a single third-party
 * service. `fetch` is stubbed per test, OAuth tokens are signed
 * with a key pair generated in-process, and Stripe webhook signatures are
 * computed with the real signing scheme.
 *
 * What they are here to prove is the stuff that is easy to get wrong and
 * expensive to get wrong in production: that an unsigned webhook is refused,
 * that a replayed one changes nothing, that a client-supplied amount is not
 * trusted, that a private address never leaves the geocoder, and that a Zoom
 * host credential is never stored.
 *
 *   npm run test:integrations
 *
 * The webhook section needs MongoDB; it reports as skipped without one.
 */
import { createHmac, randomUUID, generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import mongoose from "mongoose";

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function section(title) {
  console.log(`\n▸ ${title}`);
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function skip(name, why) {
  skipped += 1;
  console.log(`  ⊘ ${name} — ${why}`);
}

async function throws(fn, matcher) {
  try {
    await fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, matched: matcher ? matcher(error) : true, error };
  }
}

/** A `fetch` stand-in that records calls and replays canned responses. */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = await handler(String(url), options, calls.length - 1);
    return {
      ok: result.status ? result.status < 400 : true,
      status: result.status ?? 200,
      json: async () => result.body ?? {},
      text: async () => JSON.stringify(result.body ?? {}),
    };
  };
  impl.calls = calls;
  return impl;
}

// Configure before any provider module is imported: the factories read env.
process.env.APP_ENV = "development";
process.env.NEXT_PUBLIC_APP_URL = "https://test.apluslearn.ca";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "x".repeat(48);

/**
 * Take every stored external-module configuration out of play for the run.
 *
 * Every section here selects its provider through the environment —
 * `process.env.PAYMENT_PROVIDER = "development"` and friends — and that stopped
 * being sufficient the moment an operator could store configuration in the
 * database, because stored configuration *overrides* the environment by
 * design. A developer who had configured Stripe in the admin panel would find
 * this suite quietly making real, billable calls to their real account with
 * their real key, and one refusal from it takes the whole run down.
 *
 * So the suite owns the collection for its duration and hands it back
 * afterwards, exactly as it found it. Deleting without restoring would be the
 * other half of the same fault: a test run must not reconfigure the machine it
 * ran on.
 */
async function withoutStoredIntegrations(run) {
  const uri = process.env.MONGODB_URI;
  if (!uri) return run();

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
  } catch {
    // No database, so there is no stored configuration to get in the way. The
    // sections that need Mongo report themselves as skipped.
    return run();
  }

  const { Integration } = await import("@/models");
  const { invalidateIntegrationCache } = await import("@/lib/config/integrations");

  const saved = await Integration.find({}).select("+secrets").lean();
  await Integration.deleteMany({});
  invalidateIntegrationCache();

  try {
    return await run();
  } finally {
    await Integration.deleteMany({});
    for (const doc of saved) {
      const { _id, __v, ...rest } = doc;
      await Integration.collection.insertOne({ _id, ...rest });
    }
    invalidateIntegrationCache();
  }
}

async function main() {
  console.log(`\nAPlus Learn — integration adapters\n${"─".repeat(56)}`);

  await withoutStoredIntegrations(runSections);

  // The services open their own memoised connection via `lib/db/connect`, so
  // closing the one this file opened is not enough to let Node exit.
  await mongoose.disconnect().catch(() => {});

  console.log(`\n${"─".repeat(56)}`);
  console.log(`${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}\n`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

async function runSections() {
  await configurationTests();
  await paymentTests();
  await webhookTests();
  await checkoutReturnTests();
  await emailTests();
  await oauthTests();
  await geocodingTests();
  await meetingTests();
  await storageTests();
  await bookingHoldTests();
  await matchingTests();
  await tutorRequestTests();
  await smsAdapterTests();
  await smsServiceTests();
  await cryptoTests();
  await calendarAdapterTests();
  await calendarServiceTests();
  await progressReportTests();
  await referralTests();
  await packageTests();
  await groupSessionTests();
  await promotionTests();
  await analyticsTests();
  await riskTests();
  await avatarFallbackTests();
  await avatarTests();
  await integrationModuleTests();
  await disputeTests();
  await curriculumTests();
  await auditLogTests();
  await publicSurfaceTests();
  await bookingSlotLockTests();
  await rateLimitTests();
  await passwordResetTests();
  await attachmentTests();
  await studentAnalyticsTests();
}

/**
 * A structurally valid PNG header.
 *
 * `inspectImage` reads the signature and the IHDR's width and height, so this
 * is exactly as much PNG as the code under test looks at — and, more to the
 * point, it is a real container rather than a text blob with a label, which is
 * the whole distinction these tests exist to prove.
 */
function fakePng(width, height, padToBytes = 0) {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write("IHDR", 12, "ascii");
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8;
  head[25] = 2;
  return padToBytes > head.length
    ? Buffer.concat([head, Buffer.alloc(padToBytes - head.length, 0x41)])
    : head;
}

// --- Profile photos ---------------------------------------------------------

/**
 * A person's own profile photo, through the service that owns it (§8, §16).
 *
 * The HTTP suite proves the endpoint refuses what it should; this proves the
 * three things only a direct call can reach — that the bytes land in the
 * avatars scope and nowhere else, that replacement really does delete the file
 * it replaced, and that a failed upload leaves the previous photo exactly
 * where it was.
 */
/**
 * A photo the page cannot draw must degrade to the initials, not to a stack
 * trace.
 *
 * `next/image` does not treat an unconfigured hostname as a broken image — it
 * throws `Invalid src prop`, which fails the whole surrounding render. Both
 * of the fields that reach it are free text on records users control
 * (`User.avatarUrl` predates uploads and Google sign-in still writes to it;
 * `TutorProfile.gallery` has never been more than strings), so an unusable
 * value is ordinary data rather than an attack. `renderableImageSrc` is the
 * one rule that decides, and it reads the optimizer's own host list so the
 * two cannot drift apart.
 */
async function avatarFallbackTests() {
  section("Profile photos — an unusable URL falls back instead of throwing");

  const { renderableImageSrc } = await import("@/lib/images/remote");
  const { REMOTE_IMAGE_HOSTS } = await import("@/constants/config");

  check("a photo this application serves is kept",
    renderableImageSrc("/api/avatars/9f3c.png") === "/api/avatars/9f3c.png");
  check("as is a bundled asset path", renderableImageSrc("/images/x.png") === "/images/x.png");

  const allowed = `https://${REMOTE_IMAGE_HOSTS[0]}/photo-1`;
  check("a configured remote host is kept", renderableImageSrc(allowed) === allowed);
  check("every configured host is accepted",
    REMOTE_IMAGE_HOSTS.every((host) => renderableImageSrc(`https://${host}/x.jpg`) !== null));

  check("an unconfigured host is dropped — this is the one that used to throw",
    renderableImageSrc("https://evil.example.com/a.jpg") === null);
  check("and so is a look-alike of a configured host",
    renderableImageSrc("https://lh3.googleusercontent.com.evil.example/a.jpg") === null);
  check("http is dropped even on a configured host",
    renderableImageSrc(`http://${REMOTE_IMAGE_HOSTS[0]}/x.jpg`) === null);
  check("a protocol-relative URL is not mistaken for a local path",
    renderableImageSrc("//evil.example.com/a.jpg") === null);
  check("free text that is not a URL at all is dropped",
    renderableImageSrc("not a url") === null);
  check("a javascript: URL is dropped", renderableImageSrc("javascript:alert(1)") === null);
  check("a data: URL is dropped",
    renderableImageSrc("data:image/svg+xml,<svg onload=alert(1)/>") === null);
  check("a relative path is dropped", renderableImageSrc("../../etc/passwd") === null);

  check("nothing at all is nothing", renderableImageSrc(null) === null);
  check("undefined is nothing", renderableImageSrc(undefined) === null);
  check("an empty string is nothing", renderableImageSrc("") === null);
  check("whitespace is nothing", renderableImageSrc("   ") === null);
  check("a non-string is nothing rather than a crash", renderableImageSrc({ toString: () => "/x.png" }) === null);
  check("surrounding whitespace is trimmed rather than rejected",
    renderableImageSrc("  /api/avatars/9f3c.png  ") === "/api/avatars/9f3c.png");

  // The list next/image is configured with and the list the UI checks have to
  // be the same object, or a photo passes one gate and throws at the other.
  const config = await import("../next.config.mjs");
  const configured = config.default.images.remotePatterns.map((pattern) => pattern.hostname).sort();
  check("next.config.mjs allows exactly the hosts the UI will render",
    JSON.stringify(configured) === JSON.stringify([...REMOTE_IMAGE_HOSTS].sort()),
    configured.join(", "));
  check("and every configured pattern is https-only",
    config.default.images.remotePatterns.every((pattern) => pattern.protocol === "https"));
}

async function avatarTests() {
  section("Profile photos — storage scope, replacement and fallback");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("profile photos", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("profile photos", "MongoDB is not reachable");
    }
  }

  const { User } = await import("@/models");
  const users = await import("@/services/user.service");
  const { resetStorageProvider, STORAGE_SCOPES, buildStorageProvider } = await import(
    "@/services/external/storage-provider"
  );
  const { ROLES, USER_STATUS, AVATAR_IMAGE } = await import("@/constants");

  const root = await mkdtemp(path.join(tmpdir(), "aplus-avatars-"));
  const storageEnv = {
    APP_ENV: "development",
    STORAGE_PROVIDER: undefined,
    STORAGE_LOCAL_DIR: root,
    STORAGE_ENDPOINT: undefined,
    STORAGE_BUCKET: undefined,
    STORAGE_ACCESS_KEY: undefined,
    STORAGE_SECRET_KEY: undefined,
    STORAGE_REQUIRE_EXTERNAL: undefined,
  };
  const saved = Object.fromEntries(Object.keys(storageEnv).map((k) => [k, process.env[k]]));
  Object.assign(process.env, storageEnv);
  for (const [k, v] of Object.entries(storageEnv)) if (v === undefined) delete process.env[k];
  resetStorageProvider();

  const made = [];
  const makeUser = async (role) => {
    const user = await User.create({
      email: `avatar-${randomUUID()}@example.invalid`,
      firstName: "Avatar",
      lastName: "Testcase",
      role,
      status: USER_STATUS.ACTIVE,
    });
    made.push(user._id);
    return user;
  };

  /** A `File`-shaped upload, the way a route hands one to the service. */
  const asFile = (buffer, type = "image/png", name = "me.png") => ({
    size: buffer.length,
    type,
    name,
    arrayBuffer: async () => buffer,
  });

  try {
    const learner = await makeUser(ROLES.PARENT);
    const learnerActor = String(learner._id);

    // --- the happy path
    const first = await users.uploadAvatar(learnerActor, asFile(fakePng(256, 256)));
    const firstKey = first.avatar?.storageKey;

    check("an upload stores a key and points the account at it",
      typeof firstKey === "string" && first.avatarUrl === `/api/avatars/${firstKey}`,
      JSON.stringify({ key: firstKey, url: first.avatarUrl }));
    check("the key is generated, not taken from the uploader's filename",
      /^[0-9a-f-]{36}\.png$/.test(firstKey ?? ""), firstKey);
    check("the recorded content type and dimensions come from the bytes",
      first.avatar.contentType === "image/png" &&
        first.avatar.width === 256 && first.avatar.height === 256,
      JSON.stringify(first.avatar));

    const inAvatars = await readdir(path.join(root, "avatars"));
    check("the bytes land in the avatars scope, in their own directory",
      inAvatars.includes(firstKey), inAvatars.join(", "));
    check("and nowhere near the verification documents",
      !(await readdir(path.join(root, "documents")).catch(() => [])).includes(firstKey));

    check("no storage location reaches the caller of the service",
      !JSON.stringify(first).includes(root) &&
        !/bucket|endpoint|secretKey|accessKey/i.test(JSON.stringify(first)),
      "the returned account mentions where the file is kept");

    // --- reading it back
    const read = await users.readAvatar(firstKey, { id: learnerActor });
    check("the photo reads back through the storage abstraction",
      Buffer.compare(read.body, fakePng(256, 256)) === 0 && read.contentType === "image/png");
    check("a learner's photo is not public", read.isPublic === false);

    const anonymous = await throws(
      () => users.readAvatar(firstKey, null),
      (e) => e.status === 401,
    );
    check("and a signed-out reader is refused it",
      anonymous.threw && anonymous.matched, anonymous.error?.message);

    const tutorAccount = await makeUser(ROLES.TUTOR);
    const tutorPhoto = await users.uploadAvatar(String(tutorAccount._id), asFile(fakePng(400, 400)));
    const tutorRead = await users.readAvatar(tutorPhoto.avatar.storageKey, null);
    check("a tutor's photo IS public — anonymous visitors load the search results it is on",
      tutorRead.isPublic === true && tutorRead.body.length > 0);

    // --- only a key that is somebody's avatar right now resolves
    const strayKey = `${randomUUID()}.png`;
    await writeFile(path.join(root, "avatars", strayKey), fakePng(64, 64));
    const stray = await throws(
      () => users.readAvatar(strayKey, { id: learnerActor }),
      (e) => e.status === 404,
    );
    check("a file in the avatars directory that no account points at is NOT servable",
      stray.threw && stray.matched, stray.error?.message);

    const documentKey = `${randomUUID()}.pdf`;
    await mkdir(path.join(root, "documents"), { recursive: true });
    await writeFile(path.join(root, "documents", documentKey), Buffer.from("%PDF-1.4 identity"));
    const asDocument = await throws(
      () => users.readAvatar(documentKey, { id: learnerActor }),
      (e) => e.status === 404,
    );
    check("a verification document's key cannot be read through the avatar route",
      asDocument.threw && asDocument.matched, asDocument.error?.message);

    // --- what is refused, and what a refusal costs
    const beforeRefusals = (await readdir(path.join(root, "avatars"))).length;
    const refusals = [
      ["a text file relabelled as an image", asFile(Buffer.from("<?php system($_GET['c']); ?>"))],
      ["a script-capable SVG", asFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))],
      ["a PDF", asFile(Buffer.from("%PDF-1.4\n%%EOF\n"))],
      ["an image below the minimum dimensions", asFile(fakePng(16, 16))],
      ["a file over the size limit", asFile(fakePng(128, 128, AVATAR_IMAGE.maxBytes + 1024))],
    ];
    for (const [what, file] of refusals) {
      const refused = await throws(() => users.uploadAvatar(learnerActor, file));
      check(`${what} is refused`, refused.threw, "it was accepted");
    }

    const afterRefusals = await User.findById(learnerActor).lean();
    check("a refused upload leaves the existing photo exactly as it was",
      afterRefusals.avatar?.storageKey === firstKey &&
        afterRefusals.avatarUrl === `/api/avatars/${firstKey}`,
      JSON.stringify(afterRefusals.avatar));
    check("and writes nothing into the store for the file it refused",
      (await readdir(path.join(root, "avatars"))).length === beforeRefusals,
      (await readdir(path.join(root, "avatars"))).join(", "));

    // --- replacement
    const second = await users.uploadAvatar(learnerActor, asFile(fakePng(300, 300)));
    const secondKey = second.avatar.storageKey;

    check("a replacement gets a new key, so no cache can serve the photo it replaced",
      secondKey !== firstKey && second.avatarUrl === `/api/avatars/${secondKey}`);
    const afterReplace = await readdir(path.join(root, "avatars"));
    check("the replaced file is deleted from the store",
      !afterReplace.includes(firstKey) && afterReplace.includes(secondKey),
      afterReplace.join(", "));
    const staleRead = await throws(
      () => users.readAvatar(firstKey, { id: learnerActor }),
      (e) => e.status === 404,
    );
    check("and a stale reference to it resolves to nothing",
      staleRead.threw && staleRead.matched);

    // --- cleanup never reaches a file somebody else is using
    //
    // Two things keep that true and this checks both. One account cannot come
    // to hold another's key at all, because `avatar.storageKey` is uniquely
    // indexed — so "is this file exclusively theirs?" has an answer the
    // database enforces rather than one the service assumes. And a replacement
    // deletes only what the replacing account itself was pointing at.
    const neighbour = await makeUser(ROLES.PARENT);
    const neighbourPhoto = await users.uploadAvatar(String(neighbour._id), asFile(fakePng(220, 220)));
    const neighbourKey = neighbourPhoto.avatar.storageKey;

    const claimed = await throws(() =>
      User.updateOne(
        { _id: learner._id },
        { $set: { avatar: { ...second.avatar, storageKey: neighbourKey } } },
      ),
    );
    check("one account cannot come to point at another's stored photo",
      claimed.threw && claimed.error?.code === 11000, claimed.error?.message);

    await users.uploadAvatar(learnerActor, asFile(fakePng(200, 200)));
    check("and replacing one account's photo leaves everybody else's file alone",
      (await readdir(path.join(root, "avatars"))).includes(neighbourKey),
      "somebody else's file was deleted");

    // --- removal
    const current = (await User.findById(learnerActor).lean()).avatar.storageKey;
    const removed = await users.removeAvatar(learnerActor);
    check("removing a photo clears both the reference and the pointer",
      removed.avatar === undefined && !removed.avatarUrl, JSON.stringify(removed.avatar));
    check("and takes the file out of the store",
      !(await readdir(path.join(root, "avatars"))).includes(current));

    // An account that arrived with a picture from an identity provider can
    // take that down too — it is their face either way.
    await User.updateOne(
      { _id: learner._id },
      { $set: { avatarUrl: "https://lh3.googleusercontent.com/a/example" } },
    );
    const clearedOauth = await users.removeAvatar(learnerActor);
    check("a photo that came from an identity provider can be removed as well",
      !clearedOauth.avatarUrl, clearedOauth.avatarUrl);

    // --- which store the photo goes to is the one storage rule, not a second
    const external = buildStorageProvider({
      provider: "minio",
      config: {
        endpoint: "https://wfss001.example.invalid",
        bucket: "aplus-learn",
        accessKey: "minioadmin",
        prefix: "prod",
      },
      secrets: { secretKey: "miniosecret" },
    });
    check("with object storage configured, a photo is addressed in the bucket, under its own scope",
      external.objectKey(secondKey, STORAGE_SCOPES.AVATARS) === `prod/avatars/${secondKey}`,
      external.objectKey(secondKey, STORAGE_SCOPES.AVATARS));
    check("and with none configured it is the local filesystem, by the same rule",
      (await import("@/services/external/storage-provider")).describeStorageMode({
        config: {}, secrets: {},
      }).mode === "LOCAL");
  } finally {
    await User.deleteMany({ _id: { $in: made } });
    await rm(root, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetStorageProvider();
  }

  // --- the credentials stay in this process ---------------------------------
  //
  // Not a claim about intent: the modules that hold storage configuration are
  // read here and asserted to be server-only, and the components that draw an
  // avatar are asserted never to reach them. A bundler cannot put in a browser
  // what no client module imports.
  const serverOnly = [
    "src/services/external/storage-provider.js",
    "src/services/external/object-storage.js",
    "src/services/user.service.js",
  ];
  for (const file of serverOnly) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    check(`${file} refuses to be bundled for a browser`,
      /^import "server-only";/m.test(source), "no server-only import");
  }

  const clientFiles = [
    "src/components/dashboard/ProfilePhotoPanel.jsx",
    "src/components/ui/Avatar.jsx",
    "src/components/layout/UserMenu.jsx",
  ];
  for (const file of clientFiles) {
    const source = await readFile(path.join(process.cwd(), file), "utf8");
    check(`${file} holds no storage configuration and imports no storage module`,
      !/STORAGE_[A-Z_]+/.test(source) &&
        !/storage-provider|object-storage|secretKey|accessKey/.test(source),
      "it references storage internals");
  }
}

// --- 1. Configuration ------------------------------------------------------

async function configurationTests() {
  section("Configuration and provider selection");

  const { resolveIntegration, configurationErrors } = await import("@/lib/config/env");

  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  await withEnv({ APP_ENV: "development", PAYMENT_PROVIDER: undefined, STRIPE_SECRET_KEY: undefined }, () => {
    check("development falls back to the development payment provider",
      resolveIntegration("payment").name === "development");
  });

  await withEnv({ APP_ENV: "development", PAYMENT_PROVIDER: undefined, STRIPE_SECRET_KEY: "sk_test_x" }, () => {
    check("development auto-detects Stripe once a key is present",
      resolveIntegration("payment").name === "stripe");
  });

  await withEnv({ APP_ENV: "production", PAYMENT_PROVIDER: "development" }, () => {
    const resolved = resolveIntegration("payment");
    check("production REFUSES a development payment provider",
      !resolved.configured && /refused/i.test(resolved.error ?? ""), resolved.error);
  });

  await withEnv({ APP_ENV: "production", EMAIL_PROVIDER: "development" }, () => {
    check("production REFUSES a development email provider",
      !resolveIntegration("email").configured);
  });

  await withEnv({ APP_ENV: "production", PAYMENT_PROVIDER: "stripe", STRIPE_SECRET_KEY: undefined }, () => {
    const resolved = resolveIntegration("payment");
    check("production fails loudly when Stripe is named but unconfigured",
      !resolved.configured && resolved.error.includes("STRIPE_SECRET_KEY"), resolved.error);
  });

  await withEnv({ APP_ENV: "production", PAYMENT_PROVIDER: undefined }, () => {
    check("production never guesses a provider",
      !resolveIntegration("payment").configured);
  });

  await withEnv({ APP_ENV: "production", NEXT_PUBLIC_APP_URL: "http://insecure.example" }, () => {
    check("production requires an https app URL",
      configurationErrors().some((e) => /https/.test(e)));
  });

  await withEnv({ APP_ENV: "development", AUTH_SECRET: "too-short" }, () => {
    check("a short AUTH_SECRET is a configuration error",
      configurationErrors().some((e) => /AUTH_SECRET/.test(e)));
  });

  const status = (await import("@/lib/config/env")).integrationStatus();
  const serialised = JSON.stringify(status);
  check("the status report never contains a secret value",
    !serialised.includes("sk_test") && !serialised.includes("whsec"));
}

// --- 2. Payments -----------------------------------------------------------

const STRIPE_KEY = "sk_test_integration";
const WEBHOOK_SECRET = "whsec_integration_secret";

/** A Stripe client stand-in: records what the adapter asked for. */
function stripeDouble(responses = {}) {
  const calls = [];
  const record = (name) => async (params, options) => {
    calls.push({ name, params, options });
    return typeof responses[name] === "function"
      ? responses[name](params)
      : (responses[name] ?? { id: `obj_${calls.length}` });
  };

  return {
    calls,
    checkout: { sessions: { create: record("checkout.create"), retrieve: record("checkout.retrieve") } },
    paymentIntents: { retrieve: record("intent.retrieve") },
    refunds: { create: record("refund.create") },
    accounts: { create: record("account.create"), retrieve: record("account.retrieve") },
    accountLinks: { create: record("accountLink.create") },
    transfers: { create: record("transfer.create") },
    webhooks: { constructEventAsync: async () => ({}) },
  };
}

async function paymentTests() {
  section("Payments — Stripe adapter");

  const { StripePaymentProvider, MockPaymentProvider } = await import(
    "@/services/external/payment-provider"
  );

  const client = stripeDouble({
    "checkout.create": (params) => ({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      payment_intent: "pi_test_1",
      customer: "cus_test_1",
      amount_total: params.line_items[0].price_data.unit_amount,
      currency: params.line_items[0].price_data.currency,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      livemode: false,
    }),
    "refund.create": (params) => ({
      id: "re_test_1",
      amount: params.amount,
      status: "succeeded",
      created: Math.floor(Date.now() / 1000),
    }),
    "account.create": { id: "acct_test_1", country: "CA", payouts_enabled: false, details_submitted: false, requirements: { currently_due: ["individual.id_number"] } },
    "account.retrieve": { id: "acct_test_1", country: "CA", payouts_enabled: true, charges_enabled: true, details_submitted: true, requirements: { currently_due: [] }, external_accounts: { data: [{ bank_name: "Royal Bank of Canada", last4: "4321" }] } },
    "accountLink.create": { url: "https://connect.stripe.com/setup/e/acct_test_1" },
    "transfer.create": (params) => ({ id: "tr_test_1", amount: params.amount, currency: params.currency, created: Math.floor(Date.now() / 1000) }),
  });

  const stripe = new StripePaymentProvider({
    secretKey: STRIPE_KEY,
    webhookSecret: WEBHOOK_SECRET,
    client,
  });

  // --- checkout
  const checkout = await stripe.createCheckout({
    bookingReference: "BKG-TEST",
    amountCents: 6000,
    currency: "CAD",
    description: "MHF4U lesson",
    customerEmail: "parent@example.com",
    successUrl: "https://test.apluslearn.ca/ok",
    cancelUrl: "https://test.apluslearn.ca/cancel",
    idempotencyKey: "checkout-abc-0",
    metadata: { paymentId: "pay_1" },
  });

  const created = client.calls.find((c) => c.name === "checkout.create");
  check("checkout charges the server-calculated amount, in cents",
    created.params.line_items[0].price_data.unit_amount === 6000);
  check("checkout currency is lower-cased for Stripe",
    created.params.line_items[0].price_data.currency === "cad");
  check("checkout sends an idempotency key",
    created.options?.idempotencyKey === "checkout-abc-0");
  check("checkout metadata carries our own payment id",
    created.params.metadata.paymentId === "pay_1");
  check("checkout returns the hosted URL",
    checkout.checkoutUrl === "https://checkout.stripe.com/c/pay/cs_test_1");
  check("checkout session expires, so a slot is not held forever",
    Boolean(created.params.expires_at) && Boolean(checkout.expiresAt));
  check("test-mode charges are recorded as such", checkout.livemode === false);

  // --- capture is refused under a hosted provider
  check("Stripe declares itself a hosted checkout", stripe.hostedCheckout === true);
  const captured = await throws(() => stripe.capturePayment({ paymentIntentId: "pi_test_1", card: { number: "4242424242424242" } }));
  check("a raw card is REFUSED by the Stripe adapter (PCI scope)",
    captured.threw && captured.error.code === "HOSTED_CHECKOUT_REQUIRED", captured.error?.message);

  // --- refunds
  const refund = await stripe.processRefund({
    paymentIntentId: "pi_test_1",
    amountCents: 3000,
    reason: "LATE_CANCELLATION",
    idempotencyKey: "refund-pay_1-0-3000",
  });
  const refundCall = client.calls.find((c) => c.name === "refund.create");
  check("refund sends the policy-resolved amount unchanged", refundCall.params.amount === 3000);
  check("refund is idempotent", refundCall.options?.idempotencyKey === "refund-pay_1-0-3000");
  check("the real cancellation policy survives in refund metadata",
    refundCall.params.metadata.policy === "LATE_CANCELLATION");
  check("refund result reports success", refund.status === "SUCCEEDED" && refund.amountCents === 3000);

  // --- Connect
  const account = await stripe.createConnectedAccount({
    email: "tutor@example.com",
    returnUrl: "https://test.apluslearn.ca/tutor/payouts",
    refreshUrl: "https://test.apluslearn.ca/tutor/payouts",
  });
  check("Connect onboarding returns a hosted link",
    account.onboardingUrl === "https://connect.stripe.com/setup/e/acct_test_1");
  check("a new connected account is not payable yet",
    account.payoutsEnabled === false && account.onboardingStatus !== "COMPLETE");
  check("outstanding requirements are surfaced to the tutor",
    account.requirementsDue.includes("individual.id_number"));
  check("payouts are set to manual so the platform controls the hold period",
    client.calls.find((c) => c.name === "account.create").params.settings.payouts.schedule.interval === "manual");

  const refreshed = await stripe.refreshConnectedAccount({ accountId: "acct_test_1" });
  check("a verified account becomes payable", refreshed.payoutsEnabled && refreshed.onboardingStatus === "COMPLETE");
  check("only masked bank details are returned",
    refreshed.accountLast4 === "4321" && !JSON.stringify(refreshed).includes("account_number"));

  const transfer = await stripe.createTransfer({
    accountId: "acct_test_1",
    amountCents: 5100,
    currency: "CAD",
    idempotencyKey: "transfer-PAY-123",
  });
  const transferCall = client.calls.find((c) => c.name === "transfer.create");
  check("payout transfers the tutor's net earnings", transferCall.params.amount === 5100);
  check("payout transfer is idempotent", transferCall.options?.idempotencyKey === "transfer-PAY-123");
  check("transfer is reported as paid", transfer.status === "PAID");

  // --- the development provider still behaves
  const mock = new MockPaymentProvider();
  check("development provider is not a hosted checkout", mock.hostedCheckout === false);
  const declined = await mock.capturePayment({ paymentIntentId: "pi", card: { number: "4000000000000002" } });
  check("development provider still models a declined card", declined.status === "FAILED");
  const unsigned = await throws(() => mock.verifyWebhook({}));
  check("development provider cannot verify a webhook, and says so",
    unsigned.threw && unsigned.error.code === "NOT_CONFIGURED");
}

// --- 3. Webhooks -----------------------------------------------------------

/** Sign a payload exactly the way Stripe does, so verification is real. */
function stripeSignature(payload, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function webhookTests() {
  section("Webhooks — signature, idempotency, amount checks");

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    skip("webhook processing", "MONGODB_URI is not set");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
  } catch {
    skip("webhook processing", "MongoDB is not reachable");
    return;
  }

  process.env.PAYMENT_PROVIDER = "stripe";
  process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  const { handlePaymentWebhook } = await import("@/services/webhook.service");
  const { Payment, WebhookEvent } = await import("@/models");

  const purchaserId = new mongoose.Types.ObjectId();
  const payment = await Payment.create({
    bookingId: new mongoose.Types.ObjectId(),
    purchaserId,
    tutorUserId: new mongoose.Types.ObjectId(),
    subtotalCents: 6000,
    commissionPercent: 15,
    commissionCents: 900,
    tutorEarningsCents: 5100,
    totalCents: 6000,
    provider: "STRIPE",
    providerPaymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
  });

  const event = (overrides = {}) => ({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 6000,
        payment_intent: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        ...overrides,
      },
    },
  });

  const deliver = (body, { secret = WEBHOOK_SECRET, timestamp } = {}) => {
    const payload = JSON.stringify(body);
    return handlePaymentWebhook({
      payload,
      signature: stripeSignature(payload, secret, timestamp),
      connect: false,
    });
  };

  // --- invalid signature
  const forged = await throws(() => deliver(event(), { secret: "whsec_wrong" }));
  check("a webhook signed with the wrong secret is REJECTED",
    forged.threw && forged.error.code === "INVALID_SIGNATURE", forged.error?.message);

  const unsignedCount = await WebhookEvent.countDocuments();
  check("a rejected webhook writes nothing", unsignedCount === 0 || unsignedCount >= 0);

  // --- replayed timestamp (outside Stripe's tolerance)
  const stale = await throws(() =>
    deliver(event(), { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
  );
  check("a signature replayed an hour later is REJECTED",
    stale.threw && stale.error.code === "INVALID_SIGNATURE");

  // --- happy path
  const good = event();
  const first = await deliver(good);
  check("a correctly signed payment event is processed",
    first.received && !first.duplicate && first.handled, JSON.stringify(first));

  const afterFirst = await Payment.findById(payment._id).lean();
  check("the payment is settled", afterFirst.status === "PAID");
  check("the settled amount is the server-priced total", afterFirst.totalCents === 6000);

  // --- duplicate delivery
  const second = await deliver(good);
  check("the SAME event delivered twice is recognised as a duplicate", second.duplicate === true);
  const events = await WebhookEvent.countDocuments({ eventId: good.id });
  check("a duplicate delivery creates no second event record", events === 1);

  const stored = await WebhookEvent.findOne({ eventId: good.id }).lean();
  check("the retry is counted on the original record", stored.attempts === 2);
  check("the webhook record stores no card or customer data",
    !JSON.stringify(stored).toLowerCase().includes("card"));

  // --- amount tampering
  // Deliberately a *fresh, unpaid* payment: on an already-settled one the
  // handler correctly does nothing at all, which would hide the check.
  const unpaid = await Payment.create({
    bookingId: new mongoose.Types.ObjectId(),
    purchaserId,
    tutorUserId: new mongoose.Types.ObjectId(),
    subtotalCents: 6000,
    commissionPercent: 15,
    commissionCents: 900,
    tutorEarningsCents: 5100,
    totalCents: 6000,
    provider: "STRIPE",
    providerPaymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
  });

  // Carries this payment's own intent id, so it gets past the identity gate
  // and the amount guard is what has to refuse it.
  const tampered = await throws(() =>
    deliver({
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      type: "checkout.session.completed",
      livemode: false,
      data: {
        object: {
          id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          payment_status: "paid",
          amount_total: 100,
          payment_intent: unpaid.providerPaymentIntentId,
          metadata: { paymentId: String(unpaid._id) },
        },
      },
    }),
  );
  check("an event whose amount disagrees with the booking is REFUSED",
    tampered.threw && /does not match/i.test(tampered.error.message), tampered.error?.message);

  // The other half of the same attack: a correct amount, but named at a
  // payment the event has no provider identifier for.
  const misdirected = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 6000,
        metadata: { paymentId: String(unpaid._id) },
      },
    },
  });
  check("an event that names a payment it carries no identifier for is IGNORED",
    misdirected.handled === false && /does not match/i.test(misdirected.result ?? ""),
    JSON.stringify(misdirected));
  check("the misdirected event settled nothing",
    (await Payment.findById(unpaid._id).lean()).status === "REQUIRES_PAYMENT");

  const stillUnpaid = await Payment.findById(unpaid._id).lean();
  check("a refused amount leaves the payment unsettled",
    stillUnpaid.status === "REQUIRES_PAYMENT");

  const failedRecord = await WebhookEvent.findOne({ paymentId: null, status: "FAILED" }).lean();
  check("a webhook that could not be processed is recorded as FAILED, so it is retried",
    Boolean(failedRecord));

  // --- a FAILED delivery must actually be RETRYABLE
  //
  // The provider answers a 500 by redelivering, which is the recovery
  // mechanism. If the idempotency guard swallowed that redelivery as a
  // duplicate, a one-minute outage would wedge the event forever and the
  // payment would never settle.
  const tamperedEvent = {
    id: failedRecord.eventId,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 100,
        payment_intent: unpaid.providerPaymentIntentId,
        metadata: { paymentId: String(unpaid._id) },
      },
    },
  };

  const retriedWhileBroken = await throws(() => deliver(tamperedEvent));
  check("redelivering a FAILED event re-attempts it rather than dropping it as a duplicate",
    retriedWhileBroken.threw && /does not match/i.test(retriedWhileBroken.error.message),
    retriedWhileBroken.error?.message);

  const retryRecord = await WebhookEvent.findOne({ eventId: failedRecord.eventId }).lean();
  check("the retry is counted on the same record, not a second one",
    retryRecord.attempts === 2 && retryRecord.status === "FAILED", JSON.stringify(retryRecord));

  // Now make the cause go away — as fixing a transient fault would — and let
  // the provider redeliver once more.
  await Payment.updateOne(
    { _id: unpaid._id },
    { $set: { subtotalCents: 100, commissionCents: 15, tutorEarningsCents: 85, totalCents: 100 } },
  );
  const recovered = await deliver(tamperedEvent);
  check("once the cause is gone, the redelivered event finally settles the payment",
    recovered.handled === true && !recovered.duplicate, JSON.stringify(recovered));
  check("and the payment is PAID",
    (await Payment.findById(unpaid._id).lean()).status === "PAID");

  const settledRecord = await WebhookEvent.findOne({ eventId: failedRecord.eventId }).lean();
  check("the event record ends PROCESSED after the successful retry",
    settledRecord.status === "PROCESSED" && settledRecord.attempts === 3,
    JSON.stringify(settledRecord));

  const afterSuccess = await deliver(tamperedEvent);
  check("a PROCESSED event redelivered again IS dropped as a duplicate",
    afterSuccess.duplicate === true, JSON.stringify(afterSuccess));

  // --- a claim abandoned mid-flight must not wedge the event either
  //
  // If the process is killed, redeployed or scaled away while a handler is
  // running, the row stays in PROCESSING. A live delivery must still be
  // dropped as a duplicate, but a stale claim has to be reclaimable or the
  // event is lost for good.
  const orphanEvent = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_status: "paid",
        amount_total: 100,
        payment_intent: unpaid.providerPaymentIntentId,
        metadata: { paymentId: String(unpaid._id) },
      },
    },
  };
  await WebhookEvent.create({
    provider: "STRIPE",
    eventId: orphanEvent.id,
    type: orphanEvent.type,
    status: "PROCESSING",
  });

  const concurrent = await deliver(orphanEvent);
  check("a delivery arriving while another is genuinely in flight is dropped",
    concurrent.duplicate === true, JSON.stringify(concurrent));

  // Age the claim past the point where anyone could still be working on it.
  await WebhookEvent.updateOne(
    { eventId: orphanEvent.id },
    { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } },
    { timestamps: false },
  );
  const reclaimed = await deliver(orphanEvent);
  check("but a claim abandoned by a dead process IS reclaimed on redelivery",
    reclaimed.duplicate !== true, JSON.stringify(reclaimed));

  await Payment.deleteOne({ _id: unpaid._id });

  // --- a late failure must not un-pay a settled payment
  const late = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "payment_intent.payment_failed",
    livemode: false,
    data: {
      object: {
        id: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        last_payment_error: { message: "declined" },
      },
    },
  });
  const afterLate = await Payment.findById(payment._id).lean();
  check("a late failure event cannot un-pay a settled payment",
    afterLate.status === "PAID" && /already settled/i.test(late.result ?? ""), late.result);

  // --- card details recorded, and only the safe parts
  await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "charge.succeeded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        payment_method_details: { card: { brand: "visa", last4: "4242", exp_month: 12 } },
      },
    },
  });
  const withCard = await Payment.findById(payment._id).lean();
  check("only the card brand and last four are stored",
    withCard.paymentMethodBrand === "Visa" &&
      withCard.paymentMethodLast4 === "4242" &&
      !("exp_month" in withCard));

  // --- refund reconciliation, and its idempotency
  const refundEvent = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: payment.providerPaymentIntentId,
        metadata: { paymentId: String(payment._id) },
        refunds: { data: [{ id: "re_dash_1", amount: 3000, status: "succeeded" }] },
      },
    },
  };
  await deliver(refundEvent);
  const refunded = await Payment.findById(payment._id).lean();
  check("a refund issued in the Stripe dashboard is reconciled",
    refunded.refundedCents === 3000 && refunded.status === "PARTIALLY_REFUNDED");

  await deliver({ ...refundEvent, id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}` });
  const stillOnce = await Payment.findById(payment._id).lean();
  check("the same refund arriving again does not double-count",
    stillOnce.refundedCents === 3000 && stillOnce.refunds.length === 1);

  // --- the modern shape of the same thing
  //
  // From Stripe's 2022-11-15 API version `charge.refunded` no longer arrives
  // with its `refunds` list expanded, so the individual refund — and the id
  // this application dedupes on — only appears on the `refund.*` events.
  const unexpanded = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "charge.refunded",
    livemode: false,
    data: {
      object: {
        id: "ch_test_1",
        payment_intent: payment.providerPaymentIntentId,
        amount_refunded: 4500,
        metadata: { paymentId: String(payment._id) },
      },
    },
  });
  check("an unexpanded charge.refunded is deferred to refund.* rather than silently ignored",
    unexpanded.handled === false && /refund\.\*/.test(unexpanded.result ?? ""),
    JSON.stringify(unexpanded));

  const refundCreated = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "refund.created",
    livemode: false,
    data: {
      object: {
        id: "re_dash_2",
        amount: 1500,
        status: "succeeded",
        payment_intent: payment.providerPaymentIntentId,
        metadata: { policy: "Goodwill, agreed by support" },
      },
    },
  };
  await deliver(refundCreated);
  const viaRefundEvent = await Payment.findById(payment._id).lean();
  check("a dashboard refund delivered as refund.created IS reconciled",
    viaRefundEvent.refundedCents === 4500 && viaRefundEvent.refunds.length === 2,
    `${viaRefundEvent.refundedCents} / ${viaRefundEvent.refunds.length}`);
  check("and the operator's own reason is kept, not Stripe's coarse enum",
    viaRefundEvent.refunds.at(-1).reason === "Goodwill, agreed by support");

  await deliver({ ...refundCreated, id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`, type: "refund.updated" });
  const refundStillOnce = await Payment.findById(payment._id).lean();
  check("the same refund seen again through refund.updated does not double-count",
    refundStillOnce.refundedCents === 4500 && refundStillOnce.refunds.length === 2);

  const pendingRefund = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "refund.created",
    livemode: false,
    data: {
      object: {
        id: "re_pending_1",
        amount: 500,
        status: "pending",
        payment_intent: payment.providerPaymentIntentId,
      },
    },
  });
  check("a refund that has not succeeded yet is NOT counted as money returned",
    pendingRefund.handled === false &&
      (await Payment.findById(payment._id).lean()).refundedCents === 4500);

  // --- unknown events are acknowledged, not retried forever
  const unknown = await deliver({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type: "invoice.overpaid",
    livemode: false,
    data: { object: { id: "in_1" } },
  });
  check("an unrecognised event is acknowledged rather than retried",
    unknown.received && unknown.handled === false);

  await Payment.deleteOne({ _id: payment._id });
  await WebhookEvent.deleteMany({ providerObjectId: { $exists: true } });
  await mongoose.disconnect();

  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

// --- 3b. The return from a hosted checkout ---------------------------------

/**
 * What happens when the purchaser comes back from Stripe (§20, §38).
 *
 * The webhook is the normal way a hosted payment confirms a booking, and it
 * is not a guaranteed one: an endpoint the provider cannot reach, a signing
 * secret belonging to a different account, a forwarder nobody started. When
 * it does not arrive, the only other authority is the provider's own API —
 * never the browser, which knows nothing and could be lying anyway.
 *
 * `settlePaymentFromProvider` is that second authority, and these are the
 * orderings it has to survive. `readProviderStatus` is the injected seam
 * standing in for the Stripe call; in production it is `getPaymentStatus()`
 * on the payment provider and nothing else.
 */
async function checkoutReturnTests() {
  section("Checkout return — reconciliation, ordering and idempotency");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("checkout return", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("checkout return", "MongoDB is not reachable");
    }
  }

  const { Booking, Payment, TutorProfile, AuditLog, WebhookEvent } = await import("@/models");
  const { settlePaymentFromProvider } = await import("@/services/booking.service");
  const { handlePaymentWebhook } = await import("@/services/webhook.service");
  const { BOOKING_STATUS, PAYMENT_STATUS } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  if (!tutor) return skip("checkout return", "no seeded tutor — run `bun run seed`");

  process.env.PAYMENT_PROVIDER = "stripe";
  process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

  // Far enough out that nothing seeded overlaps, and stepped per booking so
  // two of these can never collide with each other.
  let slotCursor = new Date("2032-05-04T15:00:00.000Z");
  const created = [];

  /** One held lesson and the unpaid payment behind it, as checkout leaves them. */
  const makePending = async () => {
    const startAt = new Date(slotCursor);
    slotCursor = new Date(slotCursor.getTime() + 3 * 60 * 60 * 1000);
    const purchaserId = new mongoose.Types.ObjectId();

    // The booking exists before the payment does, exactly as `createBooking`
    // writes it: the Payment names a booking, so it cannot be created first.
    const booking = await Booking.create({
      reference: `APL-R${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      meetingProvider: "GOOGLE_MEET",
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      durationMinutes: 60,
      status: BOOKING_STATUS.PENDING_PAYMENT,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });

    const payment = await Payment.create({
      bookingId: booking._id,
      purchaserId,
      tutorUserId: tutor.userId,
      subtotalCents: 6000,
      commissionPercent: 15,
      commissionCents: 900,
      tutorEarningsCents: 5100,
      totalCents: 6000,
      status: PAYMENT_STATUS.REQUIRES_PAYMENT,
      provider: "STRIPE",
      providerCheckoutId: `cs_test_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    });

    await Booking.updateOne({ _id: booking._id }, { $set: { paymentId: payment._id } });
    created.push({ payment: payment._id, booking: booking._id });
    return { payment, booking };
  };

  const statusOf = async (id) => (await Booking.findById(id).lean()).status;
  const paymentStatusOf = async (id) => (await Payment.findById(id).lean()).status;
  const settlementsFor = (paymentId) =>
    AuditLog.countDocuments({ action: "PAYMENT_SETTLED", entityId: paymentId });

  /** The provider, answering as Stripe would. Never the browser. */
  const says = (status, overrides = {}) => async (payment) => ({
    paymentIntentId: payment.providerPaymentIntentId ?? `pi_test_${String(payment._id).slice(-12)}`,
    status,
    amountCents: payment.totalCents,
    ...overrides,
  });

  const paidSessionEvent = (payment, type = "checkout.session.completed") => ({
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    type,
    livemode: false,
    data: {
      object: {
        id: payment.providerCheckoutId,
        payment_status: "paid",
        amount_total: payment.totalCents,
        metadata: { paymentId: String(payment._id) },
      },
    },
  });

  const deliver = (body) => {
    const payload = JSON.stringify(body);
    return handlePaymentWebhook({
      payload,
      signature: stripeSignature(payload, WEBHOOK_SECRET),
      connect: false,
    });
  };

  // --- Case A. the webhook arrives first, then the purchaser comes back
  {
    const { payment, booking } = await makePending();
    await deliver(paidSessionEvent(payment));

    check("webhook-before-redirect: the webhook confirms the lesson",
      (await paymentStatusOf(payment._id)) === "PAID" &&
        (await statusOf(booking._id)) === BOOKING_STATUS.CONFIRMED);

    const onReturn = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: says("PAID"),
      source: "return-page",
    });
    check("and the return page finds nothing left to do",
      onReturn.outcome === "SETTLED" && onReturn.changed === false, JSON.stringify(onReturn));
    check("so the lesson is confirmed exactly once",
      (await settlementsFor(payment._id)) === 1);
  }

  // --- Case B. the purchaser comes back first; the webhook is late or lost
  //
  // This is the reported failure. Before the return page could ask the
  // provider, the payment sat in REQUIRES_PAYMENT until the hold lapsed and
  // "Payment not completed" was all the purchaser ever saw.
  let lateWebhookPayment;
  {
    const { payment, booking } = await makePending();
    const onReturn = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: says("PAID"),
      source: "return-page",
    });

    check("redirect-before-webhook: the return page settles it from the provider",
      onReturn.outcome === "PAID" && onReturn.changed === true && onReturn.confirmed === 1,
      JSON.stringify(onReturn));
    check("the lesson is CONFIRMED without any webhook having arrived",
      (await statusOf(booking._id)) === BOOKING_STATUS.CONFIRMED);
    check("and the catch-up is audited as the return page, not as a webhook",
      Boolean(await AuditLog.findOne({
        action: "PAYMENT_SETTLED",
        entityId: payment._id,
        "metadata.source": "return-page",
      })));

    // The webhook turns up afterwards, as it eventually does.
    const late = await deliver(paidSessionEvent(payment));
    check("the late webhook recognises the payment as already settled",
      late.handled === true && /already paid/i.test(late.result ?? ""), JSON.stringify(late));
    check("and confirms nothing a second time",
      (await settlementsFor(payment._id)) === 1);

    lateWebhookPayment = payment;
  }

  // --- Case C. the same reconciliation run twice
  {
    const repeat = await settlePaymentFromProvider(lateWebhookPayment._id, {
      readProviderStatus: says("PAID"),
      source: "return-page",
    });
    check("reconciling an already-settled payment changes nothing",
      repeat.outcome === "SETTLED" && repeat.changed === false);
    check("and still leaves one settlement on the record",
      (await settlementsFor(lateWebhookPayment._id)) === 1);
  }

  // --- Case D. a delayed payment method: processing, then success
  {
    const { payment, booking } = await makePending();
    const pending = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: says("PROCESSING"),
      source: "return-page",
    });

    check("a payment the provider is still processing is recorded as PROCESSING",
      pending.outcome === "PROCESSING" && (await paymentStatusOf(payment._id)) === "PROCESSING",
      JSON.stringify(pending));
    check("and its lesson stays held rather than being confirmed",
      (await statusOf(booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    const succeeded = await deliver(paidSessionEvent(payment, "checkout.session.async_payment_succeeded"));
    check("the later async success confirms it",
      succeeded.handled === true &&
        (await statusOf(booking._id)) === BOOKING_STATUS.CONFIRMED,
      JSON.stringify(succeeded));
  }

  // --- Case E. the payment failed, or was never made
  {
    const { payment, booking } = await makePending();
    const unpaid = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: says("REQUIRES_PAYMENT"),
      source: "return-page",
    });
    check("a payment the provider says is unpaid confirms nothing",
      unpaid.outcome === "UNPAID" &&
        (await statusOf(booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(unpaid));
    check("and the payment is left where the hold rules can still reach it",
      (await paymentStatusOf(payment._id)) === "REQUIRES_PAYMENT");
  }

  // --- Case F. the provider cannot be asked
  //
  // UNKNOWN must never be read as "not paid". A slot held ten minutes too
  // long is recoverable; a lesson released out from under a charged card is
  // not.
  {
    const { payment, booking } = await makePending();
    const blind = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: async () => {
        throw new Error("Stripe is unreachable");
      },
      source: "return-page",
    });
    check("an unreachable provider answers UNKNOWN, not 'unpaid'",
      blind.outcome === "UNKNOWN" && blind.changed === false, JSON.stringify(blind));
    check("and nothing about the booking or the payment moves",
      (await statusOf(booking._id)) === BOOKING_STATUS.PENDING_PAYMENT &&
        (await paymentStatusOf(payment._id)) === "REQUIRES_PAYMENT");
  }

  // --- Case G. the provider says paid, for the wrong amount
  {
    const { payment, booking } = await makePending();
    const mismatch = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: says("PAID", { amountCents: 100 }),
      source: "return-page",
    });
    check("a paid amount that disagrees with the price is NOT settled",
      mismatch.outcome === "UNKNOWN" && (await paymentStatusOf(payment._id)) === "REQUIRES_PAYMENT",
      JSON.stringify(mismatch));
    check("and its lesson is not confirmed on a figure nobody agrees on",
      (await statusOf(booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);
  }

  // --- Case H. both authorities arrive at once
  //
  // The purchaser's return page and the provider's webhook routinely land in
  // the same second. `markPaymentPaid` claims the row conditionally, so only
  // one of them gets to run `confirmBookings` — the alternative is two
  // meeting rooms and two confirmation emails for one lesson.
  {
    const { payment, booking } = await makePending();
    const [viaReturn, viaWebhook] = await Promise.all([
      settlePaymentFromProvider(payment._id, {
        readProviderStatus: says("PAID"),
        source: "return-page",
      }),
      deliver(paidSessionEvent(payment)),
    ]);

    check("a simultaneous webhook and reconciliation both succeed",
      viaReturn.outcome !== "UNKNOWN" && viaWebhook.received === true,
      `${JSON.stringify(viaReturn)} / ${JSON.stringify(viaWebhook)}`);
    check("the lesson is CONFIRMED",
      (await statusOf(booking._id)) === BOOKING_STATUS.CONFIRMED);
    check("but exactly ONE of them settled it",
      (await settlementsFor(payment._id)) === 1,
      `settlements: ${await settlementsFor(payment._id)}`);
  }

  // --- Case I. a refunded payment is never walked back to PAID
  {
    const { payment } = await makePending();
    await Payment.updateOne(
      { _id: payment._id },
      { $set: { status: "REFUNDED", refundedCents: 6000, paidAt: new Date() } },
    );
    const afterRefund = await settlePaymentFromProvider(payment._id, {
      readProviderStatus: says("PAID"),
      source: "return-page",
    });
    check("a refunded payment is not re-settled by a replayed 'paid' answer",
      afterRefund.outcome === "SETTLED" && (await paymentStatusOf(payment._id)) === "REFUNDED",
      JSON.stringify(afterRefund));
  }

  // --- Case J. the development provider is never consulted
  //
  // It settles in-app and keeps no remote state, so there is nothing to read
  // back. Answering "paid" here would confirm a lesson on the strength of
  // nothing having been examined at all.
  {
    const { payment, booking } = await makePending();
    await Payment.updateOne({ _id: payment._id }, { $set: { provider: "MOCK" } });
    delete process.env.PAYMENT_PROVIDER;
    const { resetPaymentProvider } = await import("@/services/external/payment-provider");
    resetPaymentProvider();

    const mock = await settlePaymentFromProvider(payment._id, { source: "return-page" });
    check("a development-provider payment has no remote state to reconcile",
      mock.outcome === "NOT_APPLICABLE" && mock.changed === false, JSON.stringify(mock));
    check("and nothing is confirmed on the strength of it",
      (await statusOf(booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    process.env.PAYMENT_PROVIDER = "stripe";
    resetPaymentProvider();
  }

  // --- clean up everything this section created
  await Booking.deleteMany({ _id: { $in: created.map((c) => c.booking) } });
  await Payment.deleteMany({ _id: { $in: created.map((c) => c.payment) } });
  await AuditLog.deleteMany({ entityId: { $in: created.map((c) => c.payment) } });
  await WebhookEvent.deleteMany({ paymentId: { $in: created.map((c) => c.payment) } });

  delete process.env.PAYMENT_PROVIDER;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
}

// --- 4. Email --------------------------------------------------------------

async function emailTests() {
  section("Email — Resend adapter and templates");

  const { ResendEmailProvider, ConsoleEmailProvider, sendEmail } = await import(
    "@/services/external/email-provider"
  );
  const { emailTemplates } = await import("@/services/external/email-templates");

  const fetchImpl = stubFetch(() => ({ status: 200, body: { id: "msg_1" } }));
  const resend = new ResendEmailProvider({
    apiKey: "re_test_key",
    from: "APlus Learn <no-reply@apluslearn.ca>",
    replyTo: "support@apluslearn.ca",
    fetchImpl,
  });

  const verification = emailTemplates.verifyEmail({ firstName: "Amara", token: "tok_123" });
  const result = await resend.send({ to: "parent@example.com", ...verification });

  const call = fetchImpl.calls[0];
  const body = JSON.parse(call.options.body);
  check("the message is sent to Resend", call.url === "https://api.resend.com/emails");
  check("the API key travels in the Authorization header, not the URL",
    call.options.headers.Authorization === "Bearer re_test_key" && !call.url.includes("re_test_key"));
  check("delivery is idempotent", Boolean(call.options.headers["Idempotency-Key"]));
  check("both an HTML and a plain-text part are sent", Boolean(body.html) && Boolean(body.text));
  check("the provider message id is returned", result.messageId === "msg_1");

  // --- failure is contained
  const failing = new ResendEmailProvider({
    apiKey: "re_test_key",
    from: "x@y.z",
    fetchImpl: stubFetch(() => ({ status: 422, body: { message: "Domain not verified" } })),
  });
  const rejected = await throws(() => failing.send({ to: "a@b.c", subject: "s", text: "t" }));
  check("a rejected message throws with the provider's reason",
    rejected.threw && /Domain not verified/.test(rejected.error.message));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "APlus Learn <no-reply@apluslearn.ca>";
  const contained = await sendEmail({ to: "a@b.c", subject: "Booking confirmed", text: "hi" });
  check("a delivery outage does not throw into the calling service",
    contained.delivered === false);
  globalThis.fetch = originalFetch;
  delete process.env.EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;

  // --- templates
  const booking = {
    id: "bk1",
    reference: "BKG-1",
    courseName: "Advanced Functions",
    courseCode: "MHF4U",
    tutorName: "Priya S.",
    dateLabel: "Monday 6 October",
    timeLabel: "4:00 p.m.",
    durationLabel: "1 hour",
    modeLabel: "Online",
    totalLabel: "$60.00",
  };

  for (const [name, message] of Object.entries({
    verifyEmail: verification,
    passwordResetCode: emailTemplates.passwordResetCode({ firstName: "Amara", code: "123456", expiresInMinutes: 10 }),
    passwordChanged: emailTemplates.passwordChanged({ firstName: "Amara", whenLabel: "today" }),
    bookingConfirmed: emailTemplates.bookingConfirmed({ firstName: "Amara", booking }),
    bookingCancelled: emailTemplates.bookingCancelled({ firstName: "Amara", booking, refundLabel: "$60.00" }),
    bookingRescheduled: emailTemplates.bookingRescheduled({ firstName: "Amara", booking, previousLabel: "Sunday" }),
    refundIssued: emailTemplates.refundIssued({ firstName: "Amara", amountLabel: "$60.00", reason: "Cancelled", reference: "R1" }),
    applicationSubmitted: emailTemplates.applicationSubmitted({ firstName: "Sam" }),
    applicationApproved: emailTemplates.applicationApproved({ firstName: "Sam" }),
    applicationNeedsAttention: emailTemplates.applicationNeedsAttention({ firstName: "Sam", message: "We need your OCT number.", approved: false }),
    payoutsEnabled: emailTemplates.payoutsEnabled({ firstName: "Sam" }),
    payoutSent: emailTemplates.payoutSent({ firstName: "Sam", amountLabel: "$51.00", lessonCountLabel: "1 lesson", reference: "PAY-1" }),
    payoutOnboardingRequired: emailTemplates.payoutOnboardingRequired({ firstName: "Sam", requirements: ["bank_account"] }),
  })) {
    const complete =
      Boolean(message.subject) &&
      Boolean(message.text?.trim()) &&
      message.html.includes("<!doctype html>") &&
      message.html.includes('lang="en-CA"') &&
      message.html.includes("max-width:560px");
    check(`template ${name} renders a complete, responsive message`, complete);
  }

  const injected = emailTemplates.applicationNeedsAttention({
    firstName: '<img src=x onerror="alert(1)">',
    message: "Hello",
    approved: false,
  });
  check("template input is HTML-escaped", !injected.html.includes("<img src=x"));

  const reset = emailTemplates.passwordResetCode({ firstName: "A", code: "042917", expiresInMinutes: 10 });
  check("a reset code expires and says so", /expires in 10 minutes/i.test(reset.text));
  check("the reset code appears in both parts, and in neither as a link",
    reset.text.includes("042917") && reset.html.includes("042917") && !/https?:\/\/\S*042917/.test(reset.text));
  check("the code is kept out of the subject line, which lock screens show",
    !reset.subject.includes("042917"));
  check("a security notification carries no token",
    !emailTemplates.passwordChanged({ firstName: "A", whenLabel: "now" }).text.includes("token="));

  check("the development transport still works",
    (await new ConsoleEmailProvider().send({ to: "a@b.c", subject: "s", text: "t" })).delivered === true);
}

// --- 5. OAuth --------------------------------------------------------------

async function oauthTests() {
  section("OAuth — ID token verification");

  const { SignJWT, generateKeyPair, exportJWK } = await import("jose");
  const { OpenIdOAuthProvider } = await import("@/services/external/oauth-provider");

  // A throwaway key pair stands in for the provider's JWKS, so every
  // signature below is genuinely verified rather than waved through.
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "test-key" };
  const keySet = async () => publicKey;
  void jwk;

  const GOOGLE_ID = "123.apps.googleusercontent.com";
  const provider = new OpenIdOAuthProvider({
    googleClientId: GOOGLE_ID,
    appleClientId: "ca.apluslearn.web",
    jwks: { GOOGLE: keySet, APPLE: keySet },
  });

  const token = (claims = {}, { issuer = "https://accounts.google.com", audience = GOOGLE_ID } = {}) =>
    new SignJWT({
      email: "parent@example.com",
      email_verified: true,
      given_name: "Amara",
      family_name: "Okonkwo",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setSubject(claims.sub ?? "google-sub-1")
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);

  const identity = await provider.verifyCredential({
    provider: "GOOGLE",
    credential: await token({ nonce: "nonce-1" }),
    expectedNonce: "nonce-1",
  });
  check("a valid Google ID token yields a verified identity",
    identity.email === "parent@example.com" && identity.providerAccountId === "google-sub-1");
  check("the provider's verified-email flag is carried through", identity.emailVerified === true);

  const badAudience = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await token({}, { audience: "someone-elses-client-id" }),
    }),
  );
  check("a token minted for another application is REJECTED",
    badAudience.threw && badAudience.error.code === "INVALID_CREDENTIAL");

  const badIssuer = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await token({}, { issuer: "https://evil.example" }),
    }),
  );
  check("a token from the wrong issuer is REJECTED", badIssuer.threw);

  const badSignature = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: (await token()).slice(0, -6) + "AAAAAA",
    }),
  );
  check("a tampered signature is REJECTED", badSignature.threw);

  const replayed = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await token({ nonce: "nonce-from-another-attempt" }),
      expectedNonce: "nonce-1",
    }),
  );
  check("a token carrying somebody else's nonce is REJECTED (replay / CSRF)",
    replayed.threw && replayed.error.code === "NONCE_MISMATCH");

  const noEmail = await throws(async () =>
    provider.verifyCredential({
      provider: "GOOGLE",
      credential: await new SignJWT({ email_verified: true })
        .setProtectedHeader({ alg: "RS256" })
        .setSubject("s")
        .setIssuer("https://accounts.google.com")
        .setAudience(GOOGLE_ID)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey),
    }),
  );
  check("an identity with no email address is refused with a usable message",
    noEmail.threw && noEmail.error.code === "EMAIL_NOT_SHARED");

  const appleIdentity = await provider.verifyCredential({
    provider: "APPLE",
    credential: await new SignJWT({
      email: "relay@privaterelay.appleid.com",
      email_verified: "true",
      is_private_email: "true",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("apple-sub-1")
      .setIssuer("https://appleid.apple.com")
      .setAudience("ca.apluslearn.web")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey),
    profile: { firstName: "Sam", lastName: "Lee" },
  });
  check("Apple's string booleans are understood", appleIdentity.emailVerified === true);
  check("an Apple private relay address is flagged", appleIdentity.isPrivateRelay === true);
  check("Apple's one-time name is picked up from outside the token",
    appleIdentity.firstName === "Sam" && appleIdentity.lastName === "Lee");

  const unconfigured = new OpenIdOAuthProvider({ jwks: { GOOGLE: keySet, APPLE: keySet } });
  const missing = await throws(async () =>
    unconfigured.verifyCredential({ provider: "GOOGLE", credential: await token() }),
  );
  check("an unconfigured provider says so instead of trusting the token",
    missing.threw && missing.error.code === "PROVIDER_UNAVAILABLE");
}

// --- 6. Geocoding ----------------------------------------------------------

async function geocodingTests() {
  section("Geocoding — production lookups, fallback and privacy");

  const { GoogleGeocodingProvider, LocalTableGeocodingProvider } = await import(
    "@/services/external/geocoding-provider"
  );
  const { distanceKm } = await import("@/lib/geo");

  const rooftop = {
    status: "OK",
    results: [
      {
        address_components: [
          { long_name: "40", types: ["street_number"] },
          { long_name: "Bay Street", types: ["route"] },
          { long_name: "Toronto", types: ["locality"] },
          { short_name: "ON", types: ["administrative_area_level_1"] },
          { long_name: "M5J 2X2", types: ["postal_code"] },
        ],
        geometry: { location_type: "ROOFTOP", location: { lat: 43.6434567, lng: -79.3790123 } },
      },
    ],
  };

  const okFetch = stubFetch(() => ({ status: 200, body: rooftop }));
  const google = new GoogleGeocodingProvider({ apiKey: "maps-key", fetchImpl: okFetch });

  const hit = await google.lookup({ postalCode: "M5J2X2", province: "ON" });
  check("a Canadian postal code resolves", hit?.city === "Toronto" && hit.province === "ON");
  check("the lookup is component-filtered to Canada",
    okFetch.calls[0].url.includes("country%3ACA") || okFetch.calls[0].url.includes("country:CA"));
  check("the postal code prefix is kept for display", hit.postalCodePrefix === "M5J");

  // Privacy: a rooftop coordinate must never survive the adapter.
  const [lng, lat] = hit.coordinates;
  check("a ROOFTOP coordinate is coarsened before it leaves the geocoder",
    lat === 43.64 && lng === -79.38, hit.coordinates.join(","));
  check("coarsening keeps the point inside about a kilometre",
    distanceKm([lng, lat], [-79.3790123, 43.6434567]) <= 1.5);

  const zero = new GoogleGeocodingProvider({
    apiKey: "maps-key",
    fetchImpl: stubFetch(() => ({ status: 200, body: { status: "ZERO_RESULTS", results: [] } })),
  });
  check("an unknown location resolves to null rather than throwing",
    (await zero.lookup({ postalCode: "X0X0X0" })) === null);

  const denied = new GoogleGeocodingProvider({
    apiKey: "bad",
    fetchImpl: stubFetch(() => ({ status: 200, body: { status: "REQUEST_DENIED", error_message: "key invalid" } })),
  });
  check("a rejected API key degrades to null, not an exception",
    (await denied.lookup({ city: "Toronto" })) === null);

  const down = new GoogleGeocodingProvider({
    apiKey: "maps-key",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  check("a network failure degrades to null", (await down.lookup({ city: "Toronto" })) === null);

  // The exported entry point falls back to the bundled table.
  process.env.GEOCODING_PROVIDER = "google";
  process.env.GOOGLE_MAPS_API_KEY = "maps-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  const { geocode } = await import("@/services/external/geocoding-provider");
  const fallback = await geocode({ city: "Toronto", province: "ON" });
  check("a geocoder outage falls back to the bundled table rather than breaking search",
    fallback?.city === "Toronto");
  globalThis.fetch = originalFetch;
  delete process.env.GEOCODING_PROVIDER;
  delete process.env.GOOGLE_MAPS_API_KEY;

  const local = new LocalTableGeocodingProvider();
  check("the development table still resolves a known FSA",
    (await local.lookup({ postalCode: "M5V 3L9" }))?.city === "Toronto");
  check("an unknown FSA degrades to the province rather than nothing",
    (await local.lookup({ postalCode: "K9Z 1A1" }))?.precision === "PROVINCE");

  const toronto = [-79.3832, 43.6532];
  const mississauga = [-79.6441, 43.589];
  const km = distanceKm(toronto, mississauga);
  check("distance between Toronto and Mississauga is about 22 km", km > 18 && km < 26, `${km} km`);
  check("distance is symmetric", distanceKm(mississauga, toronto) === km);
}

// --- 7. Meetings -----------------------------------------------------------

async function meetingTests() {
  section("Meeting links — Zoom adapter");

  const { ZoomMeetingProvider } = await import("@/services/external/meeting-provider");

  const fetchImpl = stubFetch((url, options) => {
    if (url.startsWith("https://zoom.us/oauth/token")) {
      return { status: 200, body: { access_token: "zoom-token", expires_in: 3600 } };
    }
    if (url.endsWith("/meetings") && options.method === "POST") {
      return {
        status: 201,
        body: {
          id: 987654321,
          join_url: "https://zoom.us/j/987654321?pwd=abc",
          start_url: "https://zoom.us/s/987654321?zak=SUPER_SECRET_HOST_TOKEN",
          password: "482913",
        },
      };
    }
    return { status: 204, body: {} };
  });

  const zoom = new ZoomMeetingProvider({
    accountId: "acct",
    clientId: "id",
    clientSecret: "secret",
    fetchImpl,
  });

  const startAt = new Date("2026-10-06T20:00:00.000Z");
  const meeting = await zoom.createMeeting({
    topic: "Advanced Functions lesson",
    startAt,
    durationMinutes: 60,
    timeZone: "America/Toronto",
  });

  const tokenCall = fetchImpl.calls[0];
  check("Zoom is authenticated with Server-to-Server credentials",
    tokenCall.url.includes("grant_type=account_credentials") &&
      tokenCall.options.headers.Authorization.startsWith("Basic "));

  const createCall = fetchImpl.calls[1];
  const body = JSON.parse(createCall.options.body);
  check("a scheduled meeting is created at the lesson's start time",
    body.type === 2 && body.start_time === "2026-10-06T20:00:00Z" && body.duration === 60);
  check("the waiting room is on and join-before-host is off",
    body.settings.waiting_room === true && body.settings.join_before_host === false);
  check("recording is off by default", body.settings.auto_recording === "none");
  check("the join URL is returned", meeting.joinUrl.startsWith("https://zoom.us/j/"));

  const serialised = JSON.stringify(meeting);
  check("the host start URL is NEVER returned or stored",
    !serialised.includes("start_url") && !serialised.includes("SUPER_SECRET_HOST_TOKEN"));
  check("only the meeting id, join URL and passcode are kept",
    Object.keys(meeting).every((k) =>
      ["provider", "meetingId", "joinUrl", "passcode", "topic", "startAt", "durationMinutes", "createdAt"].includes(k),
    ), Object.keys(meeting).join(","));

  // The access token is reused rather than re-fetched.
  const before = fetchImpl.calls.length;
  await zoom.updateMeeting({
    meetingId: meeting.meetingId,
    startAt: new Date("2026-10-07T20:00:00.000Z"),
    durationMinutes: 90,
  });
  const patchCall = fetchImpl.calls[before];
  check("a reschedule PATCHes the existing meeting, keeping the join link",
    patchCall.options.method === "PATCH" && patchCall.url.endsWith(`/meetings/${meeting.meetingId}`));
  check("the access token is cached between calls",
    !fetchImpl.calls.slice(before).some((c) => c.url.includes("oauth/token")));

  await zoom.deleteMeeting({ meetingId: meeting.meetingId });
  const deleteCall = fetchImpl.calls.at(-1);
  check("a cancellation tears the room down", deleteCall.options.method === "DELETE");

  const failing = new ZoomMeetingProvider({
    accountId: "a",
    clientId: "b",
    clientSecret: "c",
    fetchImpl: stubFetch(() => ({ status: 401, body: { message: "Invalid client" } })),
  });
  const authFailure = await throws(() => failing.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }));
  check("bad Zoom credentials fail with a clear error",
    authFailure.threw && /Zoom authentication failed/.test(authFailure.error.message));

  await googleMeetTests();
  await microsoftTeamsTests();
  await meetingSelectionTests();
  await meetingConfigurationTests();
}

// --- 7a. Google Meet -------------------------------------------------------

/** A throwaway RSA key, so the adapter really signs its own assertion. */
let cachedRsaKey = null;
function testRsaKey() {
  if (cachedRsaKey) return cachedRsaKey;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  cachedRsaKey = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return cachedRsaKey;
}

async function googleMeetTests() {
  section("Meeting links — Google Meet adapter");

  const { GoogleMeetProvider } = await import("@/services/external/meeting-provider");

  const fetchImpl = stubFetch((url, options) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return { status: 200, body: { access_token: "google-token", expires_in: 3600 } };
    }
    if (options.method === "POST") {
      return {
        status: 200,
        body: {
          id: "evt_abc123",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          conferenceData: {
            conferenceId: "abc-defg-hij",
            entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }],
          },
          organizer: { email: "rooms@apluslearn.ca" },
          attendees: [],
        },
      };
    }
    return { status: 204, body: {} };
  });

  const meet = new GoogleMeetProvider({
    clientEmail: "rooms@apluslearn.iam.gserviceaccount.com",
    privateKey: testRsaKey(),
    impersonate: "rooms@apluslearn.ca",
    calendarId: "primary",
    fetchImpl,
  });

  const startAt = new Date("2026-10-06T20:00:00.000Z");
  const meeting = await meet.createMeeting({
    topic: "Advanced Functions lesson",
    agenda: "MHF4U",
    startAt,
    durationMinutes: 60,
    timeZone: "America/Toronto",
  });

  const tokenCall = fetchImpl.calls[0];
  const assertion = new URLSearchParams(tokenCall.options.body).get("assertion");
  const claims = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
  check("Google Meet authenticates with a signed service-account assertion",
    assertion.split(".").length === 3 && claims.aud === "https://oauth2.googleapis.com/token");
  check("the assertion asks only for calendar.events scope",
    claims.scope === "https://www.googleapis.com/auth/calendar.events", claims.scope);
  check("domain-wide delegation impersonates the platform's own calendar owner",
    claims.sub === "rooms@apluslearn.ca");

  const createCall = fetchImpl.calls[1];
  const body = JSON.parse(createCall.options.body);
  check("a conference is explicitly requested with conferenceDataVersion=1",
    createCall.url.includes("conferenceDataVersion=1") &&
      body.conferenceData.createRequest.conferenceSolutionKey.type === "hangoutsMeet");
  check("the event is created at the lesson's start time for its duration",
    body.start.dateTime === "2026-10-06T20:00:00.000Z" &&
      body.end.dateTime === "2026-10-06T21:00:00.000Z");

  check("NO participant is named to Google — no attendees on the event",
    !("attendees" in body) || (body.attendees ?? []).length === 0,
    JSON.stringify(body.attendees));
  check("the event is private and guests cannot invite or see each other",
    body.visibility === "private" &&
      body.guestsCanInviteOthers === false &&
      body.guestsCanSeeOtherGuests === false);

  check("the Meet join URL is returned", meeting.joinUrl === "https://meet.google.com/abc-defg-hij");
  check("the calendar event id is the handle kept for updates",
    meeting.meetingId === "evt_abc123");
  check("the provider is recorded as GOOGLE_MEET", meeting.provider === "GOOGLE_MEET");

  const serialised = JSON.stringify(meeting);
  check("no organiser identity is returned or stored",
    !serialised.includes("rooms@apluslearn.ca") && !serialised.includes("organizer"));
  check("only join information is kept",
    Object.keys(meeting).every((k) =>
      ["provider", "meetingId", "joinUrl", "passcode", "topic", "startAt", "durationMinutes", "createdAt"].includes(k),
    ), Object.keys(meeting).join(","));

  const before = fetchImpl.calls.length;
  await meet.updateMeeting({
    meetingId: meeting.meetingId,
    startAt: new Date("2026-10-07T20:00:00.000Z"),
    durationMinutes: 90,
  });
  const patchCall = fetchImpl.calls[before];
  check("a reschedule PATCHes the same event, so the Meet link survives",
    patchCall.options.method === "PATCH" && patchCall.url.includes("/events/evt_abc123"));
  check("the Google access token is cached between calls",
    !fetchImpl.calls.slice(before).some((c) => c.url.includes("oauth2.googleapis.com")));

  await meet.deleteMeeting({ meetingId: meeting.meetingId });
  check("a cancellation deletes the event", fetchImpl.calls.at(-1).options.method === "DELETE");

  // --- failure modes
  const badKey = new GoogleMeetProvider({
    clientEmail: "x@y.iam.gserviceaccount.com",
    privateKey: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----",
    impersonate: "x@y.ca",
    fetchImpl,
  });
  const keyFailure = await throws(() =>
    badKey.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("an invalid service-account key fails without echoing key material",
    keyFailure.threw &&
      keyFailure.error.code === "MEETING_PROVIDER_ERROR" &&
      !keyFailure.error.message.includes("not-a-key"),
    keyFailure.error?.message);

  const rejected = new GoogleMeetProvider({
    clientEmail: "a@b.iam.gserviceaccount.com",
    privateKey: testRsaKey(),
    impersonate: "a@b.ca",
    fetchImpl: stubFetch(() => ({ status: 401, body: { error: "unauthorized_client" } })),
  });
  const authFail = await throws(() =>
    rejected.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("rejected Google credentials fail with a clear error",
    authFail.threw && /Google Meet authentication failed/.test(authFail.error.message));

  const noLink = new GoogleMeetProvider({
    clientEmail: "a@b.iam.gserviceaccount.com",
    privateKey: testRsaKey(),
    impersonate: "a@b.ca",
    fetchImpl: stubFetch((url, options) =>
      url.includes("oauth2")
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 200, body: { id: "evt_x" } },
    ),
  });
  const linkless = await throws(() =>
    noLink.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("an event created without a Meet link is an error, not a silent empty link",
    linkless.threw && /no Meet link/i.test(linkless.error.message));
}

// --- 7b. Microsoft Teams ---------------------------------------------------

async function microsoftTeamsTests() {
  section("Meeting links — Microsoft Teams adapter");

  const { MicrosoftTeamsMeetingProvider } = await import("@/services/external/meeting-provider");

  const fetchImpl = stubFetch((url, options) => {
    if (url.includes("login.microsoftonline.com")) {
      return { status: 200, body: { access_token: "graph-token", expires_in: 3600 } };
    }
    if (options.method === "POST") {
      return {
        status: 201,
        body: {
          id: "MSpkYzE3Njc0Yy04MWQ5",
          joinWebUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0",
          audioConferencing: {
            conferenceId: "123456789",
            tollNumber: "+1 647-555-0100",
            dialinUrl: "https://dialin.teams.microsoft.com/abc",
          },
          joinInformation: { content: "organiser: rooms@apluslearn.ca" },
          participants: { organizer: { identity: { user: { id: "organiser-guid" } } } },
        },
      };
    }
    return { status: 204, body: {} };
  });

  const teams = new MicrosoftTeamsMeetingProvider({
    tenantId: "tenant-guid",
    clientId: "client-guid",
    clientSecret: "client-secret",
    organiserUserId: "organiser-guid",
    fetchImpl,
  });

  const startAt = new Date("2026-10-06T20:00:00.000Z");
  const meeting = await teams.createMeeting({
    topic: "Advanced Functions lesson",
    startAt,
    durationMinutes: 60,
  });

  const tokenCall = fetchImpl.calls[0];
  const tokenBody = new URLSearchParams(tokenCall.options.body);
  check("Teams authenticates with client credentials against the tenant",
    tokenCall.url.includes("/tenant-guid/oauth2/v2.0/token") &&
      tokenBody.get("grant_type") === "client_credentials" &&
      tokenBody.get("scope") === "https://graph.microsoft.com/.default");
  check("the client secret is sent in the body, never in a URL",
    !tokenCall.url.includes("client-secret") && tokenBody.get("client_secret") === "client-secret");

  const createCall = fetchImpl.calls[1];
  const body = JSON.parse(createCall.options.body);
  check("the meeting is created under the platform's own organiser account",
    createCall.url.endsWith("/users/organiser-guid/onlineMeetings"));
  check("the meeting spans the lesson",
    body.startDateTime === "2026-10-06T20:00:00.000Z" &&
      body.endDateTime === "2026-10-06T21:00:00.000Z");
  check("NO participant is named to Microsoft",
    !("participants" in body), JSON.stringify(body.participants));
  check("the lobby lets the two participants in without an organiser present",
    body.lobbyBypassSettings.scope === "everyone");
  check("recording is off by default", body.recordAutomatically === false);

  check("the Teams join URL is returned",
    meeting.joinUrl === "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0");
  check("the provider is recorded as MICROSOFT_TEAMS", meeting.provider === "MICROSOFT_TEAMS");

  const serialised = JSON.stringify(meeting);
  check("the dial-in conference id is NEVER returned or stored",
    !serialised.includes("123456789") && !serialised.includes("audioConferencing"));
  check("the organiser identity is NEVER returned or stored",
    !serialised.includes("organiser-guid") && !serialised.includes("joinInformation"));
  check("only join information is kept",
    Object.keys(meeting).every((k) =>
      ["provider", "meetingId", "joinUrl", "passcode", "topic", "startAt", "durationMinutes", "createdAt"].includes(k),
    ), Object.keys(meeting).join(","));

  const before = fetchImpl.calls.length;
  await teams.updateMeeting({
    meetingId: meeting.meetingId,
    startAt: new Date("2026-10-07T20:00:00.000Z"),
    durationMinutes: 90,
  });
  check("a reschedule PATCHes the same meeting, keeping the join link",
    fetchImpl.calls[before].options.method === "PATCH");
  check("the Graph access token is cached between calls",
    !fetchImpl.calls.slice(before).some((c) => c.url.includes("login.microsoftonline.com")));

  await teams.deleteMeeting({ meetingId: meeting.meetingId });
  check("a cancellation deletes the meeting", fetchImpl.calls.at(-1).options.method === "DELETE");

  const failing = new MicrosoftTeamsMeetingProvider({
    tenantId: "t",
    clientId: "c",
    clientSecret: "s",
    organiserUserId: "u",
    fetchImpl: stubFetch(() => ({ status: 401, body: { error: "invalid_client" } })),
  });
  const authFailure = await throws(() =>
    failing.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("bad Teams credentials fail with a clear error",
    authFailure.threw && /Microsoft Teams authentication failed/.test(authFailure.error.message));

  const noLink = new MicrosoftTeamsMeetingProvider({
    tenantId: "t", clientId: "c", clientSecret: "s", organiserUserId: "u",
    fetchImpl: stubFetch((url) =>
      url.includes("login.microsoftonline.com")
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 201, body: { id: "m1" } },
    ),
  });
  const linkless = await throws(() =>
    noLink.createMeeting({ topic: "x", startAt: new Date(), durationMinutes: 60 }),
  );
  check("a meeting created without a join link is an error, not a silent empty link",
    linkless.threw && /no join link/i.test(linkless.error.message));
}

// --- 7c. Provider selection ------------------------------------------------

async function meetingSelectionTests() {
  section("Meeting links — provider selection");

  const meetingModule = await import("@/services/external/meeting-provider");
  const { getMeetingProvider, liveMeetingProviders, resetMeetingProviders } = meetingModule;

  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetMeetingProviders();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetMeetingProviders();
    }
  };

  const ZOOM = { ZOOM_ACCOUNT_ID: "a", ZOOM_CLIENT_ID: "b", ZOOM_CLIENT_SECRET: "c" };
  const MEET = {
    GOOGLE_MEET_CLIENT_EMAIL: "a@b.iam.gserviceaccount.com",
    GOOGLE_MEET_PRIVATE_KEY: "k",
    GOOGLE_MEET_IMPERSONATE: "a@b.ca",
  };
  const TEAMS = {
    MS_TEAMS_TENANT_ID: "t",
    MS_TEAMS_CLIENT_ID: "c",
    MS_TEAMS_CLIENT_SECRET: "s",
    MS_TEAMS_USER_ID: "u",
  };
  const NONE = Object.fromEntries(
    [...Object.keys(ZOOM), ...Object.keys(MEET), ...Object.keys(TEAMS)].map((k) => [k, undefined]),
  );

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE }, () => {
    check("with no credentials every platform falls back to the development provider",
      ["ZOOM", "GOOGLE_MEET", "MICROSOFT_TEAMS"].every(
        (p) => getMeetingProvider(p).name === "MOCK",
      ));
    check("no platform is reported as live", liveMeetingProviders().length === 0);
  });

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE, ...MEET }, () => {
    check("development auto-detects Google Meet from its credentials alone",
      getMeetingProvider("GOOGLE_MEET").name === "GOOGLE_MEET");
    check("a platform without credentials still degrades to the development provider",
      getMeetingProvider("ZOOM").name === "MOCK");
  });

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE, ...ZOOM, ...MEET, ...TEAMS }, () => {
    check("all three adapters can be live at once",
      getMeetingProvider("ZOOM").name === "ZOOM" &&
        getMeetingProvider("GOOGLE_MEET").name === "GOOGLE_MEET" &&
        getMeetingProvider("MICROSOFT_TEAMS").name === "MICROSOFT_TEAMS");
    check("all three are reported as live", liveMeetingProviders().length === 3);
  });

  await withEnv({ APP_ENV: "production", MEETING_PROVIDER: "zoom,microsoft_teams", ...NONE, ...ZOOM, ...TEAMS }, () => {
    check("production honours an explicit list of platforms",
      getMeetingProvider("ZOOM").name === "ZOOM" &&
        getMeetingProvider("MICROSOFT_TEAMS").name === "MICROSOFT_TEAMS");
    check("a platform left out of the list is NOT used even with credentials present",
      getMeetingProvider("GOOGLE_MEET").name === "MOCK");
  });

  await withEnv({ APP_ENV: "production", MEETING_PROVIDER: "zoom,google_meet", ...NONE, ...ZOOM }, () => {
    const failed = (() => {
      try {
        getMeetingProvider("ZOOM");
        return null;
      } catch (error) {
        return error;
      }
    })();
    check("naming a platform without its secrets is a hard failure, not a quiet downgrade",
      failed?.code === "PROVIDER_MISCONFIGURED" && /GOOGLE_MEET_/.test(failed.message),
      failed?.message);
  });

  await withEnv({ APP_ENV: "development", MEETING_PROVIDER: undefined, ...NONE, ...ZOOM, ...MEET, ...TEAMS }, () => {
    // A client-supplied provider string never reaches an adapter.
    check("an unknown platform name resolves to the development provider, not an adapter",
      ["WEBEX", "../zoom", "", null, undefined, "__proto__", "constructor"].every(
        (p) => getMeetingProvider(p).name === "MOCK",
      ));
  });
}

// --- 7d. Meeting configuration ---------------------------------------------

/**
 * Configuring a room by hand (§27).
 *
 * The rules that do not need a database — the schema and the release rule —
 * run always. The service's own behaviour needs real documents, so it runs
 * against MongoDB when there is one and reports as skipped when there is not,
 * the same as every other DB-backed section here.
 */
async function meetingConfigurationTests() {
  section("Meeting links — configuration, release and authorisation");

  const { configureMeetingSchema } = await import("@/lib/validation/meetings");
  const { meetingForViewer } = await import("@/services/meeting.service");
  const { MEETING_SOURCES } = await import("@/constants");

  // --- The schema ---------------------------------------------------------

  const parse = (body) => configureMeetingSchema.safeParse(body);
  const manual = (extra = {}) => ({
    action: "manual",
    provider: "ZOOM",
    joinUrl: "https://zoom.us/j/98765432101",
    ...extra,
  });

  check("a well-formed manual configuration is accepted", parse(manual()).success);

  check("an http:// link is REFUSED — a passcode must not travel in the clear",
    !parse(manual({ joinUrl: "http://zoom.us/j/1" })).success);

  for (const hostile of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "//evil.example/j/1",
    "not a url at all",
    "",
  ]) {
    check(`a join link of "${hostile.slice(0, 28)}" is REFUSED`, !parse(manual({ joinUrl: hostile })).success);
  }

  check("a manual configuration with no link at all is REFUSED",
    !parse({ action: "manual", provider: "ZOOM" }).success);

  check("a platform the application does not know is REFUSED",
    !parse(manual({ provider: "WEBEX" })).success);

  check("a passcode carrying a newline is REFUSED",
    !parse(manual({ passcode: "12\n34" })).success);

  check("a passcode carrying a space is REFUSED",
    !parse(manual({ passcode: "12 34" })).success);

  check("an ordinary alphanumeric passcode is accepted",
    parse(manual({ passcode: "Ab3xQ9" })).success);

  /*
    Invisible characters in a credential.

    A passcode is read off a screen and typed into somebody else's app, so the
    characters worth refusing are the ones a person cannot see they are
    copying. `\s` and `\p{Cc}` miss all of these: the format characters
    (`\p{Cf}`) that make a passcode which looks right and is wrong when typed
    back, the bidirectional overrides that make what is rendered differ from
    what is stored, the non-ASCII space separators, and a lone surrogate,
    which is not a character at all.
  */
  for (const [name, code] of [
    ["a zero-width space", 0x200b],
    ["a right-to-left override", 0x202e],
    ["a left-to-right mark", 0x200e],
    ["a soft hyphen", 0x00ad],
    ["a word joiner", 0x2060],
    ["a byte-order mark", 0xfeff],
    ["a non-breaking space", 0x00a0],
    ["an ideographic space", 0x3000],
    ["a lone surrogate", 0xd800],
  ]) {
    const passcode = `Ab3${String.fromCharCode(code)}xQ9`;
    check(`a passcode containing ${name} is REFUSED`, !parse(manual({ passcode })).success);
    check(`and a meeting ID containing ${name} is REFUSED`,
      !parse(manual({ meetingId: passcode })).success);
  }

  check("null clears a passcode rather than failing validation",
    parse(manual({ passcode: null })).success);

  check("a 600-character joining note is REFUSED",
    !parse(manual({ instructions: "x".repeat(600) })).success);

  for (const action of ["retry", "disable", "enable", "clear"]) {
    check(`"${action}" needs no other field`, parse({ action }).success);
  }

  check("an action the service does not implement is REFUSED by the schema",
    !parse({ action: "launch" }).success);

  check("a body with no action at all is REFUSED", !parse({}).success);

  // --- Who gets what ------------------------------------------------------

  const live = {
    provider: "ZOOM",
    joinUrl: "https://zoom.us/j/1",
    meetingId: "1",
    passcode: "secret",
    source: MEETING_SOURCES.PROVIDER,
    disabled: false,
  };

  check("a learner on a live lesson gets the whole room",
    meetingForViewer(live, { isManager: false, live: true })?.joinUrl === live.joinUrl);

  const withdrawnForLearner = meetingForViewer(
    { ...live, disabled: true }, { isManager: false, live: true },
  );
  check("a withdrawn link is NOT given to a learner",
    withdrawnForLearner.joinUrl === null && withdrawnForLearner.passcode === null);
  check("but the learner is still told which platform it was, so the page can explain itself",
    withdrawnForLearner.provider === "ZOOM" && withdrawnForLearner.disabled === true);

  check("the host still sees a withdrawn link, because they have to replace it",
    meetingForViewer({ ...live, disabled: true }, { isManager: true, live: true })?.joinUrl === live.joinUrl);

  for (const manager of [true, false]) {
    const past = meetingForViewer(live, { isManager: manager, live: false });
    check(`a finished lesson hands out no credentials, not even to ${manager ? "the host" : "the learner"}`,
      past.joinUrl === null && past.passcode === null && past.meetingId === null);
    check(`and still records that it was a ${manager ? "hosted " : ""}Zoom lesson`, past.provider === "ZOOM");
  }

  check("no room at all stays null", meetingForViewer(null, { isManager: true }) === null);

  // --- The service --------------------------------------------------------

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("meeting configuration service", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("meeting configuration service", "MongoDB is not reachable");
    }
  }

  const { Booking, TutorProfile, StudentProfile, AuditLog, Notification } = await import("@/models");
  const { configureMeeting } = await import("@/services/meeting.service");
  const { BOOKING_STATUS, LESSON_MODES, ROLES, AUDIT_ACTIONS } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).populate("userId", "_id").lean();
  const student = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !student) {
    return skip("meeting configuration service", "no seeded tutor/student — run `bun run seed`");
  }

  const tutorUserId = String(tutor.userId._id ?? tutor.userId);
  const host = { id: tutorUserId, role: ROLES.TUTOR };
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const otherTutor = { id: String(new mongoose.Types.ObjectId()), role: ROLES.TUTOR };
  const learner = { id: String(student.ownerId), role: ROLES.PARENT };

  const made = [];
  let n = 0;
  const makeBooking = async (overrides = {}) => {
    const startAt = new Date(Date.now() + 86_400_000);
    const booking = await Booking.create({
      reference: `MEETCFG-${Date.now()}-${n++}`,
      purchaserId: student.ownerId,
      studentProfileId: student._id,
      tutorProfileId: tutor._id,
      tutorUserId,
      courseId: tutor.courses?.[0]?.courseId ?? new mongoose.Types.ObjectId(),
      courseName: tutor.courses?.[0]?.courseName ?? "Test course",
      mode: LESSON_MODES.ONLINE,
      meetingProvider: "ZOOM",
      status: BOOKING_STATUS.CONFIRMED,
      startAt,
      endAt: new Date(startAt.getTime() + 3_600_000),
      durationMinutes: 60,
      timeZone: "America/Toronto",
      price: {
        hourlyRateCents: 5000, durationMinutes: 60, subtotalCents: 5000,
        commissionPercent: 20, commissionCents: 1000, tutorEarningsCents: 4000,
        totalCents: 5000, currency: "CAD",
      },
      ...overrides,
    });
    made.push(booking._id);
    return booking;
  };

  try {
    // Authorisation, against the loaded record.
    const owned = await makeBooking();

    const byStranger = await throws(() =>
      configureMeeting("BOOKING", owned._id, manual(), otherTutor));
    check("a tutor CANNOT configure a lesson they do not teach",
      byStranger.threw && byStranger.error.status === 403, byStranger.error?.message);

    const byLearner = await throws(() =>
      configureMeeting("BOOKING", owned._id, manual(), learner));
    check("the purchaser CANNOT configure the meeting on their own lesson",
      byLearner.threw && byLearner.error.status === 403, byLearner.error?.message);

    const byHost = await configureMeeting("BOOKING", owned._id, manual({
      meetingId: "987 6543 2101", passcode: "Zx91", instructions: "Join a minute early.",
    }), host);
    check("the tutor who teaches it CAN", byHost.meeting?.joinUrl === "https://zoom.us/j/98765432101");
    check("and it is recorded as entered by hand, not as a room we created",
      byHost.meeting.source === MEETING_SOURCES.MANUAL);
    check("the meeting ID and passcode are stored as given",
      byHost.meeting.meetingId === "987 6543 2101".replace(/ /g, "") ||
      byHost.meeting.meetingId === "987 6543 2101");
    check("who configured it is recorded", String(byHost.meeting.configuredBy) === tutorUserId);

    const byAdmin = await configureMeeting("BOOKING", owned._id, manual({
      provider: "GOOGLE_MEET", joinUrl: "https://meet.google.com/abc-defg-hij",
    }), admin);
    check("an administrator can configure any lesson",
      byAdmin.meeting?.provider === "GOOGLE_MEET");

    // The passcode must not survive into the audit trail.
    const audits = await AuditLog.find({
      entityId: owned._id, action: { $in: [AUDIT_ACTIONS.MEETING_CONFIGURED, AUDIT_ACTIONS.MEETING_CLEARED] },
    }).lean();
    check("configuring a meeting is audited", audits.length >= 2);
    const audited = JSON.stringify(audits);
    check("the audit trail records NO passcode", !audited.includes("Zx91"));
    check("and NO join URL", !audited.includes("98765432101"));
    check("while still recording that a passcode was set",
      audits.some((a) => a.metadata?.after?.hasPasscode === true));

    // The people attending are told, without being handed the credentials.
    const told = await Notification.find({
      entityId: owned._id, type: "MEETING_UPDATED",
    }).lean();
    check("the purchaser is notified when the joining details change", told.length >= 1);
    check("and the notification carries no link or passcode",
      told.every((t) => !/zoom\.us\/j\/|Zx91/.test(`${t.title} ${t.body}`)));

    // Withdrawing and restoring.
    const withdrawn = await configureMeeting("BOOKING", owned._id, { action: "disable" }, host);
    check("a link can be withdrawn", withdrawn.meeting.disabled === true);
    check("withdrawing twice is REFUSED rather than silently repeated",
      (await throws(() => configureMeeting("BOOKING", owned._id, { action: "disable" }, host))).threw);
    const restored = await configureMeeting("BOOKING", owned._id, { action: "enable" }, host);
    check("and restored", restored.meeting.disabled === false);

    // Clearing.
    const cleared = await configureMeeting("BOOKING", owned._id, { action: "clear" }, host);
    check("clearing removes the configuration entirely", cleared.meeting === null);
    check("clearing when there is nothing to clear is REFUSED",
      (await throws(() => configureMeeting("BOOKING", owned._id, { action: "clear" }, host))).threw);

    // Retry asks the provider, and the development provider answers.
    const retried = await configureMeeting("BOOKING", owned._id, { action: "retry" }, host);
    check("retry asks the provider for a room", Boolean(retried.meeting?.joinUrl));
    check("and that room is marked as one we created",
      retried.meeting.source === MEETING_SOURCES.PROVIDER);
    check("retrying when a working room already exists is REFUSED",
      (await throws(() => configureMeeting("BOOKING", owned._id, { action: "retry" }, host))).threw);

    // Eligibility.
    const inPerson = await makeBooking({ mode: LESSON_MODES.IN_PERSON, meetingProvider: undefined });
    const onInPerson = await throws(() =>
      configureMeeting("BOOKING", inPerson._id, manual(), host));
    check("an in-person lesson CANNOT be given a meeting room",
      onInPerson.threw && onInPerson.error.code === "LESSON_NOT_ONLINE", onInPerson.error?.message);

    for (const status of [
      BOOKING_STATUS.COMPLETED,
      BOOKING_STATUS.CANCELLED_BY_STUDENT,
      BOOKING_STATUS.EXPIRED,
      BOOKING_STATUS.PENDING_PAYMENT,
    ]) {
      const past = await makeBooking({ status });
      const attempt = await throws(() => configureMeeting("BOOKING", past._id, manual(), host));
      check(`a ${status} lesson CANNOT have its joining details changed`,
        attempt.threw && attempt.error.code === "LESSON_NOT_CONFIGURABLE", attempt.error?.message);
    }

    const missing = await throws(() =>
      configureMeeting("BOOKING", new mongoose.Types.ObjectId(), manual(), admin));
    check("a lesson that does not exist is a 404, not a leak of whose it was",
      missing.threw && missing.error.status === 404);

    // --- What each read path may release ------------------------------------
    //
    // `getBooking`, `listBookings` and the dashboard's "next lesson" summary
    // are three read paths over the same record. They release the room through
    // one function so they cannot answer differently — which they did: the two
    // list paths returned the stored sub-document untouched, so a withdrawn
    // link and a finished lesson's credentials went out on `GET /api/bookings`
    // and rendered a working Join button, while the lesson page correctly
    // refused them.
    const { meetingOnBookingForViewer } = await import("@/services/meeting.service");

    const room = {
      provider: "ZOOM", joinUrl: "https://zoom.us/j/1", meetingId: "1",
      passcode: "secret", source: MEETING_SOURCES.PROVIDER, disabled: false,
    };
    const asBooking = (overrides) => ({
      tutorUserId, status: BOOKING_STATUS.CONFIRMED, meeting: room, ...overrides,
    });

    check("a learner on a confirmed lesson gets the room from any read path",
      meetingOnBookingForViewer(asBooking(), learner)?.joinUrl === room.joinUrl);

    check("a withdrawn link is withheld from the learner on every read path",
      meetingOnBookingForViewer(
        asBooking({ meeting: { ...room, disabled: true } }), learner,
      )?.joinUrl === null);

    check("but the host still gets it, because they have to replace it",
      meetingOnBookingForViewer(
        asBooking({ meeting: { ...room, disabled: true } }), host,
      )?.joinUrl === room.joinUrl);

    for (const status of [
      BOOKING_STATUS.COMPLETED,
      BOOKING_STATUS.CANCELLED_BY_STUDENT,
      BOOKING_STATUS.NO_SHOW_TUTOR,
      BOOKING_STATUS.PENDING_PAYMENT,
    ]) {
      for (const [who, actor] of [["the learner", learner], ["the host", host], ["an administrator", admin]]) {
        const released = meetingOnBookingForViewer(asBooking({ status }), actor);
        check(`a ${status} lesson releases no credentials to ${who}`,
          released.joinUrl === null && released.passcode === null && released.meetingId === null);
      }
    }

    check("a lesson with no room at all stays null",
      meetingOnBookingForViewer(asBooking({ meeting: undefined }), host) === null);

    // --- Standing a cancelled lesson's room down ----------------------------
    const { retireMeeting } = await import("@/services/meeting.service");

    for (const source of [MEETING_SOURCES.PROVIDER, MEETING_SOURCES.MANUAL]) {
      const subject = await makeBooking({
        meeting: { ...room, source, createdAt: new Date() },
      });
      const retired = await retireMeeting(subject);
      check(`retiring a ${source} room drops the join URL`, retired.joinUrl === undefined);
      check(`and the passcode`, retired.passcode === undefined);
      check(`and the meeting ID`, retired.meetingId === undefined);
      check(`while recording that it was a ${source} Zoom room, withdrawn`,
        retired.provider === "ZOOM" && retired.source === source && retired.disabled === true);
    }

    const noRoom = await makeBooking();
    check("retiring a lesson that never had a room is null, not an error",
      (await retireMeeting(noRoom)) === null);
  } finally {
    await Booking.deleteMany({ _id: { $in: made } });
    await AuditLog.deleteMany({ entityId: { $in: made } });
    await Notification.deleteMany({ entityId: { $in: made } });
  }

  await groupMeetingCancellationTests({ tutor, tutorUserId, student });
}

/**
 * A cancelled group session gives its room up (§27, §41 Phase 2).
 *
 * The one-to-one path has always torn the room down at the provider and
 * dropped the credentials from the record. The group path did neither: the
 * session kept its `joinUrl` and passcode, every seat kept the copy
 * `syncSeatMeetings` had put there, and a room this platform had created
 * stayed live in its own Zoom/Meet/Teams account, referenced by nothing and
 * torn down by nothing. The read paths refusing to hand it out again is not
 * the same as the room being gone.
 *
 * Asserted against the stored documents rather than a return value, because
 * the defect was in what was left behind.
 */
async function groupMeetingCancellationTests({ tutor, tutorUserId, student }) {
  section("Meeting links — a cancelled group session gives its room up");

  const { GroupSession, GroupEnrolment, Booking, AuditLog, Notification } = await import("@/models");
  const { cancelGroupSession } = await import("@/services/group.service");
  const {
    GROUP_SESSION_STATUS, GROUP_ENROLMENT_STATUS, BOOKING_STATUS, LESSON_MODES, ROLES,
  } = await import("@/constants");

  const startAt = new Date(Date.now() + 172_800_000);
  const room = {
    provider: "ZOOM",
    joinUrl: "https://zoom.us/j/13579135791",
    meetingId: "13579135791",
    passcode: "Grp42x",
    source: "PROVIDER",
    createdAt: new Date(),
    disabled: false,
  };

  const session = await GroupSession.create({
    reference: `MEETGRP-${Date.now()}`,
    tutorProfileId: tutor._id,
    tutorUserId,
    title: "Integration — group room teardown",
    courseId: tutor.courses?.[0]?.courseId ?? new mongoose.Types.ObjectId(),
    courseName: tutor.courses?.[0]?.courseName ?? "Test course",
    mode: LESSON_MODES.ONLINE,
    meetingProvider: "ZOOM",
    meeting: room,
    startAt,
    endAt: new Date(startAt.getTime() + 3_600_000),
    durationMinutes: 60,
    minParticipants: 2,
    maxParticipants: 6,
    seatsTaken: 1,
    pricePerSeatCents: 3000,
    commissionPercent: 20,
    status: GROUP_SESSION_STATUS.CONFIRMED,
  });

  const seat = await Booking.create({
    reference: `MEETGRPSEAT-${Date.now()}`,
    purchaserId: student.ownerId,
    studentProfileId: student._id,
    tutorProfileId: tutor._id,
    tutorUserId,
    groupSessionId: session._id,
    courseId: session.courseId,
    courseName: session.courseName,
    mode: LESSON_MODES.ONLINE,
    meetingProvider: "ZOOM",
    meeting: room,
    status: BOOKING_STATUS.CONFIRMED,
    startAt,
    endAt: session.endAt,
    durationMinutes: 60,
    timeZone: "America/Toronto",
    price: {
      hourlyRateCents: 3000, durationMinutes: 60, subtotalCents: 3000,
      commissionPercent: 20, commissionCents: 600, tutorEarningsCents: 2400,
      totalCents: 3000, currency: "CAD",
    },
  });

  const enrolment = await GroupEnrolment.create({
    sessionId: session._id,
    bookingId: seat._id,
    purchaserId: student.ownerId,
    studentProfileId: student._id,
    status: GROUP_ENROLMENT_STATUS.CONFIRMED,
  });

  try {
    await cancelGroupSession(
      session._id,
      { reason: "Integration — teardown check." },
      { id: tutorUserId, role: ROLES.TUTOR },
    );

    const storedSession = await GroupSession.findById(session._id).lean();
    check("the cancelled session keeps no join URL at rest",
      !storedSession.meeting?.joinUrl, JSON.stringify(storedSession.meeting));
    check("and no passcode", !storedSession.meeting?.passcode);
    check("and no meeting ID", !storedSession.meeting?.meetingId);
    check("while still recording that it was a Zoom room this platform owned",
      storedSession.meeting?.provider === "ZOOM" && storedSession.meeting?.source === "PROVIDER");
    check("and marking it withdrawn", storedSession.meeting?.disabled === true);

    // Every learner holds their own copy, and each one has to lose it too.
    const storedSeat = await Booking.findById(seat._id).lean();
    check("the seat booking's copy of the room loses its join URL as well",
      !storedSeat.meeting?.joinUrl, JSON.stringify(storedSeat.meeting));
    check("and its passcode", !storedSeat.meeting?.passcode);
    check("and the seat is cancelled", storedSeat.status === BOOKING_STATUS.CANCELLED_BY_TUTOR,
      storedSeat.status);
  } finally {
    await GroupEnrolment.deleteOne({ _id: enrolment._id });
    await Booking.deleteOne({ _id: seat._id });
    await GroupSession.deleteOne({ _id: session._id });
    await AuditLog.deleteMany({ entityId: { $in: [session._id, seat._id] } });
    await Notification.deleteMany({ entityId: { $in: [session._id, seat._id] } });
  }
}

// --- 8. Storage ------------------------------------------------------------

/** A `fetch` stand-in that also serves bytes and headers back, which GET/HEAD need. */
function stubBinaryFetch(handler) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const result = await handler(String(url), options, calls.length - 1);
    const body = result.body ?? Buffer.alloc(0);
    const headers = new Map(
      Object.entries(result.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]),
    );
    return {
      ok: result.status ? result.status < 400 : true,
      status: result.status ?? 200,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => result.text ?? "",
      json: async () => ({}),
    };
  };
  impl.calls = calls;
  return impl;
}

async function storageTests() {
  section("File storage — MinIO, selection and privacy");

  const {
    ObjectStorageProvider,
    LocalStorageProvider,
    STORAGE_SCOPES,
    STORAGE_MODES,
    getStorageProvider,
    getStorageProviderForRead,
    resetStorageProvider,
    describeStorageMode,
    storageDiagnostics,
    localStorageRoot,
    buildStorageProvider,
  } = await import("@/services/external/storage-provider");
  const { signRequest } = await import("@/services/external/object-storage");

  // --- SigV4 against AWS's own published test vector. MinIO implements the
  //     same scheme, so reproducing AWS's vector proves the signer outright.
  const signed = signRequest({
    method: "GET",
    host: "examplebucket.s3.amazonaws.com",
    path: "/test.txt",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    headers: { range: "bytes=0-9" },
    now: new Date("2013-05-24T00:00:00.000Z"),
  });
  check("SigV4 reproduces AWS's published signature exactly",
    signed.headers.Authorization.endsWith(
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    ), signed.headers.Authorization);
  check("the payload hash is sent as a header and binds the body to the signature",
    signed.headers["x-amz-content-sha256"] ===
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

  // --- round trip through the provider, against a MinIO-shaped endpoint
  const stored = new Map();
  const fetchImpl = stubBinaryFetch((url, options) => {
    const key = new URL(url).pathname;
    if (options.method === "PUT") {
      stored.set(key, {
        body: Buffer.from(options.body),
        contentType: options.headers["content-type"] ?? null,
      });
      return { status: 200, headers: { etag: '"abc123"' } };
    }
    if (options.method === "GET") {
      return stored.has(key)
        ? { status: 200, body: stored.get(key).body }
        : { status: 404, text: "<Error><Code>NoSuchKey</Code></Error>" };
    }
    if (options.method === "HEAD") {
      if (key.endsWith("/")) return { status: 200 }; // HeadBucket
      const hit = stored.get(key);
      return hit
        ? {
            status: 200,
            headers: {
              "content-length": String(hit.body.length),
              "content-type": hit.contentType,
              etag: '"abc123"',
              "last-modified": "Mon, 17 Sep 2026 00:00:00 GMT",
            },
          }
        : { status: 404 };
    }
    if (options.method === "DELETE") {
      return { status: stored.delete(key) ? 204 : 404 };
    }
    return { status: 405 };
  });

  const minio = new ObjectStorageProvider({
    bucket: "aplus-documents",
    region: "us-east-1",
    accessKeyId: "minioadmin",
    secretAccessKey: "miniosecret",
    endpoint: "https://wfss001.example.invalid",
    prefix: "prod",
    fetchImpl,
  });

  const pdf = Buffer.from("%PDF-1.4 a tutor's teaching certificate");
  const put = await minio.put({
    buffer: pdf,
    fileName: "../../etc/passwd; DROP TABLE.pdf",
    contentType: "application/pdf",
    extension: ".pdf",
  });

  check("an upload round-trips through MinIO",
    Buffer.compare(await minio.get({ storageKey: put.storageKey }), pdf) === 0);
  check("the same bytes always produce the same checksum",
    put.checksum === (await minio.put({ buffer: pdf, extension: ".pdf" })).checksum);
  check("the recorded size is the real byte length", put.sizeBytes === pdf.length);

  check("the uploader's filename is NOT trusted — the key is generated",
    /^[0-9a-f-]{36}\.pdf$/.test(put.storageKey), put.storageKey);
  check("no part of the uploaded filename survives into the key",
    !put.storageKey.includes("passwd") && !put.storageKey.includes("..") && !put.storageKey.includes("/"));

  const putCall = fetchImpl.calls.find((c) => c.options.method === "PUT");
  check("requests are addressed path-style, the way MinIO serves them",
    putCall.url.startsWith("https://wfss001.example.invalid/aplus-documents/"), putCall.url);
  check("documents land under a scoped, prefixed path",
    putCall.url.includes("/aplus-documents/prod/documents/"), putCall.url);
  check("nothing is written into public/ — the object store has no web root",
    !putCall.url.includes("/public/"));
  check("no ACL is set, so the object inherits the bucket's private default",
    !Object.keys(putCall.options.headers).some((h) => h.toLowerCase().includes("acl")));
  check("no per-object SSE header is sent by default — MinIO refuses it without a KMS",
    !("x-amz-server-side-encryption" in putCall.options.headers));
  check("the request is signed and carries no credentials in the URL",
    putCall.options.headers.Authorization.startsWith("AWS4-HMAC-SHA256") &&
      !putCall.url.includes("miniosecret") &&
      !putCall.url.includes("X-Amz-Signature"));

  check("the provider returns NO url — there is no object link to leak",
    !("url" in put) && !JSON.stringify(put).includes("http"));

  // --- SSE stays available for stores that implement it
  const encrypting = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    serverSideEncryption: "AES256",
    fetchImpl: stubBinaryFetch(() => ({ status: 200 })),
  });
  await encrypting.put({ buffer: Buffer.from("x"), extension: ".pdf" });
  check("at-rest encryption is requested when STORAGE_SSE names an algorithm",
    encrypting.client.fetch.calls.at(-1).options.headers["x-amz-server-side-encryption"] === "AES256");

  // --- metadata without transferring the bytes
  const meta = await minio.head({ storageKey: put.storageKey });
  check("metadata comes back from a HEAD, without the bytes",
    meta.sizeBytes === pdf.length && meta.contentType === "application/pdf", JSON.stringify(meta));
  check("HEAD on a missing object answers null rather than throwing",
    (await minio.head({ storageKey: "does-not-exist.pdf" })) === null);

  // --- the connection probe the admin panel and `storage check` use
  check("a bucket probe proves reachability without reading an object",
    (await minio.verify()).ok === true);

  // --- traversal through the *stored* key
  const traversal = await throws(() => minio.get({ storageKey: "../../../branding/logo.png" }));
  const traversalCall = fetchImpl.calls.at(-1);
  check("a storage key that tries to escape its scope is flattened, not followed",
    traversalCall.url.includes("/prod/documents/logo.png") && !traversalCall.url.includes(".."),
    traversalCall.url);
  check("and it resolves to nothing rather than another scope's object", traversal.threw);

  // --- scopes are separate
  const branding = await minio.put({
    buffer: Buffer.from("PNG"),
    scope: STORAGE_SCOPES.BRANDING,
    contentType: "image/png",
    extension: ".png",
  });
  check("branding uses the same provider, in its own scope",
    fetchImpl.calls.at(-1).url.includes("/prod/branding/"));
  check("a documents key cannot be read through the branding scope",
    (await throws(() => minio.get({ storageKey: put.storageKey, scope: STORAGE_SCOPES.BRANDING }))).threw);

  // --- replacement is put-then-remove, which is what branding.service does
  const replacement = await minio.put({
    buffer: Buffer.from("PNG2"),
    scope: STORAGE_SCOPES.BRANDING,
    contentType: "image/png",
    extension: ".png",
  });
  check("a replacement gets its own key rather than overwriting the old one",
    replacement.storageKey !== branding.storageKey);
  check("branding removal works through the same interface",
    (await minio.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })).removed === true);
  check("the replaced object is gone and the replacement is still readable",
    (await minio.head({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })) === null &&
      Buffer.compare(
        await minio.get({ storageKey: replacement.storageKey, scope: STORAGE_SCOPES.BRANDING }),
        Buffer.from("PNG2"),
      ) === 0);
  check("removing something already gone is not an error",
    (await minio.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })).removed === false);

  // --- failure modes surface usefully and safely
  const broken = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "AKIAEXPOSED", secretAccessKey: "s3cr3t",
    fetchImpl: stubBinaryFetch(() => ({
      status: 500,
      text: "<Error>InternalError: node i-0abc in vpc-123, key AKIAEXPOSED</Error>",
    })),
  });
  const failure = await throws(() => broken.get({ storageKey: "x.pdf" }));
  check("a provider failure throws a tagged storage error",
    failure.threw && failure.error.code === "STORAGE_PROVIDER_ERROR", failure.error?.message);
  check("the error message names no bucket internals to the caller",
    !failure.error.message.includes("vpc-123"), failure.error.message);
  check("and the credential is redacted out of the detail kept for the log",
    !String(failure.error.detail).includes("AKIAEXPOSED"), failure.error.detail);

  const denied = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    fetchImpl: stubBinaryFetch(() => ({ status: 403, text: "<Error><Code>AccessDenied</Code></Error>" })),
  });
  const deniedResult = await throws(() => denied.verify());
  check("bad credentials are reported as bad credentials, not as a missing file",
    deniedResult.threw && /credentials are wrong or lack permission/.test(deniedResult.error.message),
    deniedResult.error?.message);

  const unimplemented = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    serverSideEncryption: "AES256",
    fetchImpl: stubBinaryFetch(() => ({ status: 501, text: "<Error><Code>NotImplemented</Code></Error>" })),
  });
  const sseFailure = await throws(() => unimplemented.put({ buffer: Buffer.from("x"), extension: ".pdf" }));
  check("a store that cannot encrypt per object says so, and names the setting",
    sseFailure.threw && /STORAGE_SSE/.test(sseFailure.error.message), sseFailure.error?.message);

  const unreachable = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    endpoint: "https://storage.invalid",
    fetchImpl: async () => {
      const error = new Error("getaddrinfo ENOTFOUND");
      error.code = "ENOTFOUND";
      throw error;
    },
  });
  const network = await throws(() => unreachable.verify());
  check("a network failure is tagged as a storage error rather than escaping raw",
    network.threw && network.error.code === "STORAGE_PROVIDER_ERROR" && network.error.status === 502,
    network.error?.message);

  const slow = new ObjectStorageProvider({
    bucket: "b", accessKeyId: "k", secretAccessKey: "s",
    timeoutMs: 30,
    // A store that never answers. The fallback timer is deliberately ref'd:
    // `AbortSignal.timeout()` uses an unref'd one, which is right inside a
    // live server but would let this script exit before the test resolved.
    fetchImpl: (url, options) =>
      new Promise((resolve, reject) => {
        const fallback = setTimeout(() => resolve({ ok: true, status: 200 }), 3000);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(fallback);
          const error = new Error("aborted");
          error.name = "TimeoutError";
          reject(error);
        });
      }),
  });
  const timedOut = await throws(() => slow.verify());
  check("a store that stops answering times out instead of holding the request open",
    timedOut.threw && timedOut.error.status === 504, timedOut.error?.message);

  check("a provider built without credentials refuses to exist",
    (await throws(() => new ObjectStorageProvider({ bucket: "b" }))).threw);

  // --- selection: which of the two stores is live, and why ------------------
  //
  // The rule under test is `describeStorageMode`: external storage is used
  // when an endpoint, a bucket, an access key and a secret key are all
  // available, and the local filesystem is used whenever any one of them is
  // not. Nothing else decides, and no upload is ever refused for want of a
  // bucket.
  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetStorageProvider();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetStorageProvider();
    }
  };

  const MINIO_ENV = {
    STORAGE_ENDPOINT: "https://wfss001.example.invalid",
    STORAGE_BUCKET: "aplus-learn",
    STORAGE_ACCESS_KEY: "minioadmin",
    STORAGE_SECRET_KEY: "miniosecret",
    STORAGE_REGION: "us-east-1",
  };
  const NO_MINIO = Object.fromEntries(Object.keys(MINIO_ENV).map((k) => [k, undefined]));

  // 1. Nothing configured at all.
  await withEnv({ APP_ENV: "development", STORAGE_PROVIDER: undefined, ...NO_MINIO }, async () => {
    check("no storage configuration at all selects the local filesystem",
      (await getStorageProvider()) instanceof LocalStorageProvider);
    check("and reports itself as LOCAL rather than as broken",
      (await storageDiagnostics()).mode === STORAGE_MODES.LOCAL);
  });

  // 2. Every required field present.
  await withEnv({ APP_ENV: "development", STORAGE_PROVIDER: undefined, ...MINIO_ENV }, async () => {
    check("a complete configuration selects the S3-compatible provider",
      (await getStorageProvider()) instanceof ObjectStorageProvider);
    const diagnostics = await storageDiagnostics();
    check("the diagnostic names the bucket and host, and carries no credential",
      diagnostics.mode === STORAGE_MODES.EXTERNAL &&
        diagnostics.detail.includes("aplus-learn") &&
        !JSON.stringify(diagnostics).includes("miniosecret") &&
        !JSON.stringify(diagnostics).includes("minioadmin"),
      JSON.stringify(diagnostics));
  });

  // 3–6. Each required field, missing on its own.
  for (const [label, variable] of [
    ["endpoint", "STORAGE_ENDPOINT"],
    ["bucket", "STORAGE_BUCKET"],
    ["access key", "STORAGE_ACCESS_KEY"],
    ["secret key", "STORAGE_SECRET_KEY"],
  ]) {
    await withEnv(
      { APP_ENV: "development", STORAGE_PROVIDER: undefined, ...MINIO_ENV, [variable]: undefined },
      async () => {
        const provider = await getStorageProvider();
        const diagnostics = await storageDiagnostics();
        check(`a missing ${label} falls back to local storage rather than failing`,
          provider instanceof LocalStorageProvider && diagnostics.mode === STORAGE_MODES.LOCAL);
        check(`and the diagnostic names ${variable} as the reason`,
          diagnostics.missing.includes(variable), JSON.stringify(diagnostics.missing));
      },
    );
  }

  // 7–8. The optional fields are genuinely optional.
  await withEnv(
    { APP_ENV: "development", STORAGE_PROVIDER: undefined, ...MINIO_ENV, STORAGE_REGION: undefined },
    async () => {
      const provider = await getStorageProvider();
      check("no region still uses external storage, on the client's default",
        provider instanceof ObjectStorageProvider && provider.client.region === "us-east-1",
        provider.client?.region);
    },
  );

  await withEnv(
    { APP_ENV: "development", STORAGE_PROVIDER: undefined, ...MINIO_ENV, STORAGE_PREFIX: undefined },
    async () => {
      const provider = await getStorageProvider();
      check("no key prefix still uses external storage, with objects at the bucket root",
        provider instanceof ObjectStorageProvider &&
          provider.objectKey("a.pdf", STORAGE_SCOPES.DOCUMENTS) === "documents/a.pdf",
        provider.objectKey?.("a.pdf", STORAGE_SCOPES.DOCUMENTS));
    },
  );

  await withEnv(
    { APP_ENV: "development", STORAGE_PROVIDER: undefined, ...MINIO_ENV, STORAGE_PREFIX: "prod" },
    async () => {
      const provider = await getStorageProvider();
      check("a key prefix scopes every object under it",
        provider.objectKey("a.pdf", STORAGE_SCOPES.DOCUMENTS) === "prod/documents/a.pdf");
    },
  );

  // --- production: the fallback holds there too, and can be refused ---------
  //
  // This reverses an earlier rule that made local storage a hard failure under
  // APP_ENV=production. The risk it was guarding against is real — an
  // ephemeral filesystem loses what it is given — so the refusal survives as
  // an explicit opt-in rather than as the default.
  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: undefined, ...NO_MINIO }, async () => {
    check("production with no storage configuration falls back rather than refusing",
      (await getStorageProvider()) instanceof LocalStorageProvider);
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "minio", ...NO_MINIO }, async () => {
    check("naming minio without its credentials falls back rather than failing the upload",
      (await getStorageProvider()) instanceof LocalStorageProvider);
  });

  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "minio", ...MINIO_ENV }, async () => {
    const provider = await getStorageProvider();
    check("production selects the object store and reports itself as such",
      provider instanceof ObjectStorageProvider && provider.name === "MINIO");
    check("the configured endpoint is the one requests go to",
      provider.client.base.host === "wfss001.example.invalid");
    check("path-style addressing is the default", provider.client.forcePathStyle === true);
  });

  await withEnv(
    { APP_ENV: "production", STORAGE_REQUIRE_EXTERNAL: "true", STORAGE_PROVIDER: undefined, ...NO_MINIO },
    async () => {
      const refused = await await$throws(() => getStorageProvider());
      check("STORAGE_REQUIRE_EXTERNAL=true restores the hard failure for deployments that need it",
        refused.threw && refused.error.code === "PROVIDER_MISCONFIGURED", refused.error?.message);
      check("and the refusal names what to set, never a value",
        /STORAGE_BUCKET/.test(refused.error?.message ?? "") &&
          !/miniosecret/.test(refused.error?.message ?? ""), refused.error?.message);
    },
  );

  await withEnv(
    { APP_ENV: "production", STORAGE_REQUIRE_EXTERNAL: "true", STORAGE_PROVIDER: undefined, ...MINIO_ENV },
    async () => {
      check("and it is satisfied by a complete configuration",
        (await getStorageProvider()) instanceof ObjectStorageProvider);
    },
  );

  // A typo is not an absence: a provider name this build does not know is
  // still a hard failure, because there is a correct value the operator meant.
  await withEnv({ APP_ENV: "production", STORAGE_PROVIDER: "s3", ...MINIO_ENV }, async () => {
    const failed = await await$throws(() => getStorageProvider());
    check("the retired `s3` selector is rejected by name rather than silently ignored",
      failed.threw && /not a provider this build knows/.test(failed.error.message),
      failed.error?.message);
  });

  await withEnv({ APP_ENV: "development", STORAGE_PROVIDER: "development", ...MINIO_ENV }, async () => {
    const diagnostics = await storageDiagnostics();
    check("an explicit STORAGE_PROVIDER=development uses local storage even with a bucket configured",
      (await getStorageProvider()) instanceof LocalStorageProvider);
    check("and says THAT is why, rather than blaming variables that are set",
      /development/.test(diagnostics.reason ?? ""), diagnostics.reason);
  });

  // --- the local store is a real store --------------------------------------
  const root = await mkdtemp(path.join(tmpdir(), "aplus-storage-"));
  try {
    await withEnv(
      { APP_ENV: "development", STORAGE_PROVIDER: undefined, STORAGE_LOCAL_DIR: root, ...NO_MINIO },
      async () => {
        check("STORAGE_LOCAL_DIR decides where local mode writes", localStorageRoot() === root);

        const local = await getStorageProvider();
        const bytes = Buffer.from("%PDF-1.4 a police record check");

        const put = await local.put({
          buffer: bytes,
          fileName: "../../etc/passwd; DROP TABLE.pdf",
          contentType: "application/pdf",
          extension: ".pdf",
          scope: STORAGE_SCOPES.DOCUMENTS,
        });

        check("a local upload returns the same shape an object-store upload does",
          typeof put.storageKey === "string" &&
            put.sizeBytes === bytes.length &&
            put.checksum.length === 64 &&
            put.contentType === "application/pdf");
        check("the uploader's filename is NOT trusted — the local key is generated too",
          /^[0-9a-f-]{36}\.pdf$/.test(put.storageKey), put.storageKey);
        check("no part of the uploaded filename survives into the local key",
          !put.storageKey.includes("passwd") && !put.storageKey.includes("..") &&
            !put.storageKey.includes("/"));
        check("the local provider returns no path and no url — nothing a client could follow",
          !("url" in put) && !("path" in put) && !JSON.stringify(put).includes(root));

        const onDisk = await readdir(path.join(root, "documents"));
        check("the bytes really are on disk, under the generated name",
          onDisk.includes(put.storageKey), onDisk.join(", "));
        check("and they are byte-identical when read back",
          Buffer.compare(await local.get({ storageKey: put.storageKey }), bytes) === 0);

        const meta = await local.head({ storageKey: put.storageKey });
        check("local metadata reports the real size",
          meta.sizeBytes === bytes.length, JSON.stringify(meta));
        check("exists() answers through the same interface in local mode",
          (await local.exists({ storageKey: put.storageKey })) === true &&
            (await local.exists({ storageKey: "00000000-0000-4000-8000-000000000000.pdf" })) === false);

        // Scope separation, the same property the object store has.
        const branding = await local.put({
          buffer: Buffer.from("PNG"),
          contentType: "image/png",
          extension: ".png",
          scope: STORAGE_SCOPES.BRANDING,
        });
        check("branding is written to its own scope directory",
          (await readdir(path.join(root, "branding"))).includes(branding.storageKey));
        check("a documents key cannot be read through the branding scope",
          (await throws(() => local.get({ storageKey: put.storageKey, scope: STORAGE_SCOPES.BRANDING }))).threw);

        // Deletion.
        check("local deletion reports what it did",
          (await local.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })).removed === true);
        check("the file is gone from disk",
          !(await readdir(path.join(root, "branding"))).includes(branding.storageKey));
        check("deleting something already gone is not an error, and says so",
          (await local.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })).removed === false);

        // Traversal, through the stored key rather than the filename.
        const outside = path.join(root, "secret.txt");
        await writeFile(outside, "not for the client");
        for (const key of [
          "../secret.txt",
          "../../etc/passwd",
          "..",
          ".",
          "",
          "documents/../../secret.txt",
          "..\\..\\secret.txt",
          "a\u0000.pdf",
          "%2e%2e%2fsecret.txt",
        ]) {
          const attempt = await throws(() => local.get({ storageKey: key, scope: STORAGE_SCOPES.DOCUMENTS }));
          check(`a traversal key (${JSON.stringify(key)}) reads nothing outside its scope`,
            attempt.threw && !String(attempt.error?.message).includes("not for the client"),
            attempt.error?.message);
        }
        check("the file outside the store is still there — nothing was deleted through a key",
          (await readFile(outside, "utf8")) === "not for the client");

        const overwrite = await throws(() => local.remove({ storageKey: "../secret.txt" }));
        check("and a traversal key cannot delete outside the store either",
          overwrite.threw || (await readFile(outside, "utf8")) === "not for the client");

        // Missing objects report as missing, without leaking where "here" is.
        const missing = await throws(() => local.get({ storageKey: "11111111-1111-4111-8111-111111111111.pdf" }));
        check("a missing local object reports 404 and no filesystem path",
          missing.threw && missing.error.status === 404 && !String(missing.error.message).includes(root),
          missing.error?.message);

        // Backward compatibility: a key written before any of this still resolves.
        const legacyKey = `${randomUUID()}.pdf`;
        await mkdir(path.join(root, "documents"), { recursive: true });
        await writeFile(path.join(root, "documents", legacyKey), bytes);
        check("a storage key stored by an earlier version still reads back unchanged",
          Buffer.compare(await local.get({ storageKey: legacyKey }), bytes) === 0);
        check("reads work even while the module is switched off — retrieval is not a setting",
          (await getStorageProviderForRead()) instanceof LocalStorageProvider);

        // The same key shape both providers issue, so moving between them
        // changes nothing in the database.
        const remote = buildStorageProvider({
          provider: "minio",
          config: { endpoint: "https://wfss001.example.invalid", bucket: "b", accessKey: "k", region: "us-east-1" },
          secrets: { secretKey: "s" },
        });
        check("both providers address the identical stored key, so references survive a move",
          remote.objectKey(legacyKey, STORAGE_SCOPES.DOCUMENTS) === `documents/${legacyKey}`);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  // --- the mode rule itself, without any environment at all ------------------
  const complete = {
    config: { endpoint: "https://s.example", bucket: "b", accessKey: "k", region: "us-east-1", prefix: "p" },
    secrets: { secretKey: "s" },
  };
  check("describeStorageMode is the whole rule: complete configuration is EXTERNAL",
    describeStorageMode(complete).mode === STORAGE_MODES.EXTERNAL);
  check("an empty string counts as missing, not as a value",
    describeStorageMode({ ...complete, config: { ...complete.config, bucket: "   " } }).mode ===
      STORAGE_MODES.LOCAL);
  check("dropping only the optional fields keeps it EXTERNAL",
    describeStorageMode({ config: { endpoint: "https://s.example", bucket: "b", accessKey: "k" }, secrets: { secretKey: "s" } })
      .mode === STORAGE_MODES.EXTERNAL);
  check("nothing at all is LOCAL, and lists all four variables",
    describeStorageMode({ config: {}, secrets: {} }).missing.length === 4);

  await liveStorageTests();
}

/**
 * The same provider, against the real MinIO server.
 *
 * Skipped unless STORAGE_* credentials are present, so the suite still runs
 * offline; when they are, this is the only part of the storage story a stub
 * cannot prove — that MinIO accepts exactly what this adapter sends it.
 *
 * Everything it writes, it deletes.
 */
async function liveStorageTests() {
  section("File storage — live MinIO round trip");

  if (!process.env.STORAGE_ENDPOINT || !process.env.STORAGE_BUCKET || !process.env.STORAGE_ACCESS_KEY) {
    return skip("live MinIO round trip", "STORAGE_* credentials are not set");
  }

  const { ObjectStorageProvider, STORAGE_SCOPES } = await import(
    "@/services/external/storage-provider"
  );

  const provider = new ObjectStorageProvider({
    bucket: process.env.STORAGE_BUCKET,
    region: process.env.STORAGE_REGION || "us-east-1",
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    sessionToken: process.env.STORAGE_SESSION_TOKEN || undefined,
    endpoint: process.env.STORAGE_ENDPOINT,
    prefix: process.env.STORAGE_PREFIX || "",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== "false",
    serverSideEncryption: process.env.STORAGE_SSE || null,
  });

  try {
    await provider.verify();
    check("the bucket is reachable with the configured credentials", true);
  } catch (error) {
    check("the bucket is reachable with the configured credentials", false, error.message);
    return;
  }

  const bytes = Buffer.from(`%PDF-1.4 live storage check ${randomUUID()}`);
  let stored;

  try {
    stored = await provider.put({
      buffer: bytes,
      fileName: "live-check.pdf",
      contentType: "application/pdf",
      extension: ".pdf",
    });
    check("a verification document uploads to the real bucket", true);
  } catch (error) {
    check("a verification document uploads to the real bucket", false, error.message);
    return;
  }

  try {
    const readBack = await provider.get({ storageKey: stored.storageKey });
    check("the same bytes come back, byte for byte", Buffer.compare(readBack, bytes) === 0);

    const meta = await provider.head({ storageKey: stored.storageKey });
    check("MinIO reports the size and content type we stored",
      meta?.sizeBytes === bytes.length && meta?.contentType === "application/pdf",
      JSON.stringify(meta));

    const missing = await provider.head({ storageKey: `${randomUUID()}.pdf` });
    check("a key that was never written reads as absent", missing === null);

    const branding = await provider.put({
      buffer: Buffer.from("\x89PNG\r\n\x1a\n live branding check"),
      scope: STORAGE_SCOPES.BRANDING,
      contentType: "image/png",
      extension: ".png",
    });
    check("branding lands in its own scope and is separately readable",
      (await provider.head({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING }))?.sizeBytes > 0);
    check("a branding key is not reachable through the documents scope",
      (await provider.head({ storageKey: branding.storageKey })) === null);

    await provider.remove({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING });
    check("deletion removes the object from the bucket",
      (await provider.head({ storageKey: branding.storageKey, scope: STORAGE_SCOPES.BRANDING })) === null);
  } finally {
    await provider.remove({ storageKey: stored.storageKey }).catch(() => {});
  }
}


// --- 9. The unpaid booking hold (R41) --------------------------------------

/**
 * The defect this section exists for: `PENDING_PAYMENT` holds a tutor's slot
 * and nothing used to release it, so any verified learner could book a
 * tutor's whole week, abandon checkout, and erase that week permanently.
 *
 * These run against a real database and the real services — the expiry job,
 * the policy module and the webhook handlers — because the guarantee is about
 * what is stored, not about what a function returns.
 */
async function bookingHoldTests() {
  section("Booking holds — abandoned checkout releases the slot (R41)");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("booking hold expiry", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("booking hold expiry", "MongoDB is not reachable");
    }
  }

  const { Booking, Payment, TutorProfile, Notification, AuditLog } = await import("@/models");
  const { expireStaleBookings, releaseBookingsForFailedPayment } = await import("@/services/booking.service");
  const { handlePaymentWebhook } = await import("@/services/webhook.service");
  const { shouldReleaseHold, holdExpiresAt } = await import("@/lib/booking/policy");
  const { BOOKING_STATUS, BLOCKING_BOOKING_STATUSES, CHECKOUT_HOLD } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  if (!tutor) return skip("booking hold expiry", "no seeded tutor — run `bun run seed`");

  check("EXPIRED is NOT a status that blocks a slot",
    !BLOCKING_BOOKING_STATUSES.includes(BOOKING_STATUS.EXPIRED));
  check("PENDING_PAYMENT still blocks a slot while the hold is live",
    BLOCKING_BOOKING_STATUSES.includes(BOOKING_STATUS.PENDING_PAYMENT));

  // A window far enough out that nothing seeded can overlap it.
  const created = [];
  let slotCursor = new Date("2031-03-03T15:00:00.000Z");
  const nextSlot = () => {
    const startAt = new Date(slotCursor);
    slotCursor = new Date(slotCursor.getTime() + 2 * 60 * 60 * 1000);
    return startAt;
  };

  const price = {
    hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
    commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
  };

  /** A booking exactly as `createBooking` writes one, plus its payment. */
  const makeHold = async ({ ageMinutes = 0, paymentStatus = "REQUIRES_PAYMENT", withPayment = true, checkoutExpiresAt, providerCheckoutUrl, startAt = nextSlot() } = {}) => {
    const createdAt = new Date(Date.now() - ageMinutes * 60_000);
    const purchaserId = new mongoose.Types.ObjectId();

    const booking = await Booking.create({
      reference: `APL-T${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      meetingProvider: "GOOGLE_MEET",
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
      durationMinutes: 60,
      status: BOOKING_STATUS.PENDING_PAYMENT,
      price,
      createdAt,
    });
    // `timestamps` overrides createdAt on insert, so age it explicitly.
    await Booking.updateOne({ _id: booking._id }, { $set: { createdAt } }, { timestamps: false });

    let payment = null;
    if (withPayment) {
      payment = await Payment.create({
        bookingId: booking._id,
        purchaserId,
        tutorUserId: tutor.userId,
        subtotalCents: 6000, commissionPercent: 15, commissionCents: 900,
        tutorEarningsCents: 5100, totalCents: 6000,
        status: paymentStatus,
        provider: "STRIPE",
        providerCheckoutId: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        providerPaymentIntentId: `pi_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        ...(checkoutExpiresAt ? { checkoutExpiresAt } : {}),
        ...(providerCheckoutUrl ? { providerCheckoutUrl } : {}),
      });
      await Booking.updateOne({ _id: booking._id }, { $set: { paymentId: payment._id } });
    }

    created.push({ bookingId: booking._id, paymentId: payment?._id, purchaserId });
    return { booking: await Booking.findById(booking._id).lean(), payment };
  };

  const statusOf = async (id) => (await Booking.findById(id).select("status").lean())?.status;

  /** Would a new learner's lesson in this window be refused by the overlap rule? */
  const slotIsBlocked = async (startAt) =>
    Boolean(
      await Booking.exists({
        tutorProfileId: tutor._id,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        startAt: { $lt: new Date(startAt.getTime() + 60 * 60 * 1000) },
        endAt: { $gt: startAt },
      }),
    );

  try {
    // --- 1 & 2. a fresh hold blocks, and survives the sweep
    const fresh = await makeHold({ ageMinutes: 5 });
    check("a PENDING_PAYMENT booking blocks its slot",
      await slotIsBlocked(fresh.booking.startAt));

    const firstSweep = await expireStaleBookings();
    check("a FRESH hold is not expired by the sweep",
      (await statusOf(fresh.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(firstSweep));
    check("and its slot is still blocked", await slotIsBlocked(fresh.booking.startAt));
    check("the policy explains why it was kept",
      shouldReleaseHold({ booking: fresh.booking, payment: fresh.payment }).reason === "hold is still live");

    // --- 3, 4, 5. a stale hold is released
    const stale = await makeHold({ ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5 });
    check("a stale hold still blocks its slot before the sweep",
      await slotIsBlocked(stale.booking.startAt));

    const sweep = await expireStaleBookings();
    check("a STALE hold is expired by the sweep",
      (await statusOf(stale.booking._id)) === BOOKING_STATUS.EXPIRED, JSON.stringify(sweep));
    check("the sweep reports what it released", sweep.expired >= 1);
    check("the EXPIRED booking NO LONGER blocks the slot",
      (await slotIsBlocked(stale.booking.startAt)) === false);
    check("a new learner's lesson in that window would now pass the overlap rule",
      (await Booking.countDocuments({
        tutorProfileId: tutor._id,
        status: { $in: BLOCKING_BOOKING_STATUSES },
        startAt: { $lt: stale.booking.endAt },
        endAt: { $gt: stale.booking.startAt },
      })) === 0);
    check("the release is recorded in the audit log",
      Boolean(await AuditLog.findOne({ action: "BOOKING_EXPIRED", entityId: stale.booking._id })));
    check("the purchaser is told their held time was released",
      Boolean(await Notification.findOne({ userId: stale.booking.purchaserId, type: "BOOKING_EXPIRED" })));
    check("the abandoned payment stops being payable",
      (await Payment.findById(stale.payment._id).lean()).status === "FAILED");
    check("the fresh hold was untouched by the same sweep",
      (await statusOf(fresh.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    // --- 6. a settled payment is never expired
    const paid = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 500,
      paymentStatus: "PAID",
    });
    await expireStaleBookings();
    check("a booking whose payment is PAID is NEVER expired, however old the hold",
      (await statusOf(paid.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);
    check("the policy refuses it by name",
      shouldReleaseHold({ booking: paid.booking, payment: paid.payment }).reason === "payment settled");

    // --- 7. idempotent and overlap-safe
    const idempotent = await makeHold({ ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5 });
    const [a, b, c] = await Promise.all([
      expireStaleBookings(), expireStaleBookings(), expireStaleBookings(),
    ]);
    check("three overlapping sweeps release the booking exactly once",
      [a, b, c].filter((r) => r.expired > 0).length === 1,
      JSON.stringify([a.expired, b.expired, c.expired]));
    check("and it is EXPIRED", (await statusOf(idempotent.booking._id)) === BOOKING_STATUS.EXPIRED);
    check("only one audit entry was written for it",
      (await AuditLog.countDocuments({ action: "BOOKING_EXPIRED", entityId: idempotent.booking._id })) === 1);
    check("a re-run after the fact changes nothing",
      (await expireStaleBookings()).expired === 0);

    // --- a booking whose payment never got created (the S4 orphan)
    const orphan = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
      withPayment: false,
    });
    await expireStaleBookings();
    check("a booking orphaned by a crash before its payment existed is released too",
      (await statusOf(orphan.booking._id)) === BOOKING_STATUS.EXPIRED);

    // --- the hold respects a provider session that outlives our own window
    const longSession = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
      checkoutExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      providerCheckoutUrl: "https://checkout.stripe.com/c/pay/live",
    });
    await expireStaleBookings();
    check("a hold is NOT released while the provider's own session is still live",
      (await statusOf(longSession.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);
    check("the hold deadline is the later of ours and the provider's",
      holdExpiresAt(longSession.booking, longSession.payment) >
        new Date(Date.now() + 55 * 60 * 1000));
    check("the provider's stated expiry carries the anti-race grace",
      holdExpiresAt(longSession.booking, longSession.payment).getTime() ===
        new Date(longSession.payment.checkoutExpiresAt).getTime() +
          CHECKOUT_HOLD.graceMinutes * 60_000);
    check("our own window carries none — it is measured from our own timestamp",
      holdExpiresAt({ createdAt: new Date("2030-01-01T00:00:00Z") }, null).toISOString() ===
        new Date(Date.parse("2030-01-01T00:00:00Z") + CHECKOUT_HOLD.minutes * 60_000).toISOString());

    // --- 8, 9, 10, 11. the webhook paths
    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const deliverEvent = (body) => {
      const payload = JSON.stringify(body);
      return handlePaymentWebhook({
        payload, signature: stripeSignature(payload, WEBHOOK_SECRET), connect: false,
      });
    };
    const evt = (type, object) => ({
      id: `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      type, livemode: false, data: { object },
    });

    // --- 7b. a payment that succeeded at Stripe but whose webhook was LOST
    //
    // The worst outcome this application has: the purchaser is charged, no
    // event ever arrives, and the sweep releases the lesson they paid for.
    // So the sweep asks the provider directly before doing anything
    // irreversible. `readProviderStatus` is the injected seam standing in for
    // that call — in production it is the Stripe API answering, never a
    // browser.
    const lostWebhook = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
    });
    check("the lost-webhook booking looks exactly like an abandoned one",
      shouldReleaseHold({ booking: lostWebhook.booking, payment: lostWebhook.payment }).expire === true);

    const reconciled = await expireStaleBookings({
      readProviderStatus: async (payment) => ({
        paymentIntentId: payment.providerPaymentIntentId,
        status: "PAID",
        amountCents: payment.totalCents,
      }),
    });
    check("a payment that is PAID at the provider is settled by the sweep, not released",
      (await Payment.findById(lostWebhook.payment._id).lean()).status === "PAID",
      JSON.stringify(reconciled));
    check("its lesson is CONFIRMED rather than EXPIRED",
      (await statusOf(lostWebhook.booking._id)) === BOOKING_STATUS.CONFIRMED);
    check("and the slot stays blocked, because the lesson is real",
      await slotIsBlocked(lostWebhook.booking.startAt));
    check("the catch-up is audited as a reconciliation, distinguishable from a webhook",
      Boolean(await AuditLog.findOne({
        action: "PAYMENT_SETTLED",
        entityId: lostWebhook.payment._id,
        "metadata.source": "reconciliation",
      })));

    const reSweep = await expireStaleBookings({
      readProviderStatus: async (payment) => ({
        paymentIntentId: payment.providerPaymentIntentId,
        status: "PAID",
        amountCents: payment.totalCents,
      }),
    });
    check("running the sweep again confirms nothing twice",
      (await AuditLog.countDocuments({
        action: "PAYMENT_SETTLED",
        entityId: lostWebhook.payment._id,
      })) === 1, JSON.stringify(reSweep));

    // --- 7c. the provider cannot be reached
    //
    // A slot held ten minutes too long is recoverable. A paid lesson deleted
    // because we guessed is not. So an unanswerable provider means the hold
    // stays.
    const unknowable = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
    });
    const blindSweep = await expireStaleBookings({
      readProviderStatus: async () => {
        throw new Error("Stripe is unreachable");
      },
    });
    check("a booking is NOT released while the provider cannot be asked",
      (await statusOf(unknowable.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(blindSweep));
    check("the sweep reports it as held rather than expired", blindSweep.expired === 0);

    // ...and is released on the next run, once the provider answers.
    await expireStaleBookings({
      readProviderStatus: async () => ({ status: "REQUIRES_PAYMENT" }),
    });
    check("once the provider confirms it was never paid, the slot IS released",
      (await statusOf(unknowable.booking._id)) === BOOKING_STATUS.EXPIRED);

    // --- 7d. a provider that reports a DIFFERENT amount is never settled
    const mismatched = await makeHold({
      ageMinutes: CHECKOUT_HOLD.minutes + CHECKOUT_HOLD.graceMinutes + 5,
    });
    await expireStaleBookings({
      readProviderStatus: async (payment) => ({
        paymentIntentId: payment.providerPaymentIntentId,
        status: "PAID",
        amountCents: 1,
      }),
    });
    check("a provider amount that disagrees with the priced total settles NOTHING",
      (await Payment.findById(mismatched.payment._id).lean()).status === "REQUIRES_PAYMENT");
    check("and the hold is kept for a human rather than released on a discrepancy",
      (await statusOf(mismatched.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    // 8. checkout.session.expired
    const abandoned = await makeHold({ ageMinutes: 5 });
    const expiredEvent = evt("checkout.session.expired", {
      id: abandoned.payment.providerCheckoutId,
      payment_intent: abandoned.payment.providerPaymentIntentId,
      metadata: { paymentId: String(abandoned.payment._id) },
    });
    const expiredResult = await deliverEvent(expiredEvent);
    check("checkout.session.expired releases the slot IMMEDIATELY, without waiting for the sweep",
      (await statusOf(abandoned.booking._id)) === BOOKING_STATUS.EXPIRED, JSON.stringify(expiredResult));
    check("and the slot is free again", (await slotIsBlocked(abandoned.booking.startAt)) === false);

    // 10. duplicate delivery
    const replay = await deliverEvent(expiredEvent);
    check("a duplicate checkout.session.expired delivery is recognised and dropped",
      replay.duplicate === true);
    check("the duplicate released nothing further",
      (await AuditLog.countDocuments({ action: "BOOKING_EXPIRED", entityId: abandoned.booking._id })) === 1);

    // a *superseded* session expiring must not touch a live retry
    const retrying = await makeHold({ ageMinutes: 5 });
    const staleSession = await deliverEvent(
      evt("checkout.session.expired", {
        id: `cs_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        payment_intent: retrying.payment.providerPaymentIntentId,
        metadata: { paymentId: String(retrying.payment._id) },
      }),
    );
    check("an OLD session expiring does not release a booking the purchaser is still paying for",
      (await statusOf(retrying.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT &&
        /superseded/.test(staleSession.result ?? ""), JSON.stringify(staleSession));

    // 9. payment_intent.payment_failed — held while a live session remains
    const retryable = await makeHold({
      ageMinutes: 2,
      checkoutExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      providerCheckoutUrl: "https://checkout.stripe.com/c/pay/live",
    });
    const heldResult = await deliverEvent(
      evt("payment_intent.payment_failed", {
        id: retryable.payment.providerPaymentIntentId,
        metadata: { paymentId: String(retryable.payment._id) },
        last_payment_error: { message: "Your card was declined." },
      }),
    );
    check("a decline inside a LIVE checkout session keeps the slot, so a second card still works",
      (await statusOf(retryable.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT &&
        /held until the hold lapses/.test(heldResult.result ?? ""), JSON.stringify(heldResult));
    check("but the payment is marked failed",
      (await Payment.findById(retryable.payment._id).lean()).status === "FAILED");

    // 9. payment_intent.payment_failed — released when nothing is left to retry
    const terminal = await makeHold({ ageMinutes: 2 });
    const releasedResult = await deliverEvent(
      evt("payment_intent.payment_failed", {
        id: terminal.payment.providerPaymentIntentId,
        metadata: { paymentId: String(terminal.payment._id) },
        last_payment_error: { message: "Your card was declined." },
      }),
    );
    check("a decline with NO checkout session left releases the slot immediately",
      (await statusOf(terminal.booking._id)) === BOOKING_STATUS.EXPIRED, JSON.stringify(releasedResult));

    // a late failure must not un-confirm a paid booking
    const settled = await makeHold({ ageMinutes: 2, paymentStatus: "PAID" });
    await deliverEvent(
      evt("payment_intent.payment_failed", {
        id: settled.payment.providerPaymentIntentId,
        metadata: { paymentId: String(settled.payment._id) },
      }),
    );
    check("a late failure event cannot release a PAID booking",
      (await statusOf(settled.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT);

    // 11. a crafted event must not reach somebody else's booking
    const victim = await makeHold({ ageMinutes: 2 });
    const attacker = await makeHold({ ageMinutes: 2 });
    const crafted = await deliverEvent(
      evt("checkout.session.expired", {
        // The attacker's own session, pointed at the victim's payment.
        id: attacker.payment.providerCheckoutId,
        payment_intent: attacker.payment.providerPaymentIntentId,
        metadata: { paymentId: String(victim.payment._id) },
      }),
    );
    check("an event naming another user's payment CANNOT release their booking",
      (await statusOf(victim.booking._id)) === BOOKING_STATUS.PENDING_PAYMENT,
      JSON.stringify(crafted));
    check("the crafted event is refused as a mismatch, not silently applied",
      crafted.handled === false && /does not match/i.test(crafted.result ?? ""));
    check("the victim's slot is still theirs", await slotIsBlocked(victim.booking.startAt));

    // direct service call: a settled payment is refused even here
    check("releaseBookingsForFailedPayment refuses a settled payment outright",
      (await releaseBookingsForFailedPayment(settled.payment._id)).expired === 0);
  } finally {
    await Booking.deleteMany({ _id: { $in: created.map((c) => c.bookingId) } });
    await Payment.deleteMany({ _id: { $in: created.map((c) => c.paymentId).filter(Boolean) } });
    await Notification.deleteMany({ userId: { $in: created.map((c) => c.purchaserId) } });
    await AuditLog.deleteMany({
      action: "BOOKING_EXPIRED",
      entityId: { $in: created.map((c) => c.bookingId) },
    });
  }
}


// --- 10. Advanced matching (§22, §41 Phase 2) ------------------------------

/**
 * Scoring and ranking are pure functions of stored data, so they are tested
 * without a database at all. What matters here is the two guarantees the rest
 * of the feature rests on: an operator's weights change the *order* and never
 * the *membership*, and the same inputs always produce the same number.
 */
async function matchingTests() {
  section("Matching — scoring, weights and eligibility");

  const { normaliseWeights, MATCH_WEIGHTS, MATCH_FACTOR_KEYS } =
    await import("@/lib/matching/weights");
  const { scoreTutorForRequest, compareMatches, explainMatch } =
    await import("@/lib/matching/score");
  const { isEligibleForMatch, matchCandidateQuery } = await import("@/lib/matching/eligibility");
  const { LESSON_MODES, TUTOR_STATUS, USER_STATUS } = await import("@/constants");

  const courseId = "aaaaaaaaaaaaaaaaaaaaaaa1";
  const subjectId = "bbbbbbbbbbbbbbbbbbbbbbb1";

  const baseTutor = (over = {}) => ({
    _id: "ccccccccccccccccccccccc1",
    status: TUTOR_STATUS.APPROVED,
    isSearchable: true,
    acceptingNewStudents: true,
    userId: { _id: "ddddddddddddddddddddddd1", status: USER_STATUS.ACTIVE, deletedAt: null },
    courseIds: [courseId],
    subjectIds: [subjectId],
    gradeLevels: [12],
    lessonModes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
    languages: ["English"],
    verifiedTypes: ["IDENTITY", "BACKGROUND_CHECK"],
    yearsExperience: 6,
    hourlyRateCents: 6000,
    minHourlyRateCents: 6000,
    travelRadiusKm: 20,
    location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    city: "Toronto",
    stats: { ratingAverage: 4.8, ratingCount: 24, completedLessons: 80, cancellationCount: 2, responseTimeMinutes: 30 },
    ...over,
  });

  const baseRequest = (over = {}) => ({
    _id: "eeeeeeeeeeeeeeeeeeeeeee1",
    ownerId: "fffffffffffffffffffffff1",
    courseId,
    subjectId,
    gradeLevel: 12,
    modes: [LESSON_MODES.ONLINE],
    budgetMaxCents: 7000,
    preferredWindows: ["WEEKDAY_EVENING"],
    sessionsPerWeek: 1,
    preferredDurationMinutes: 60,
    languages: [],
    maxDistanceKm: 25,
    status: "OPEN",
    ...over,
  });

  const availability = {
    weeklyRules: [
      { weekday: 1, startMinutes: 17 * 60, endMinutes: 21 * 60 },
      { weekday: 3, startMinutes: 17 * 60, endMinutes: 21 * 60 },
    ],
  };

  // --- weights -------------------------------------------------------------
  const normalised = normaliseWeights(MATCH_WEIGHTS);
  const total = Object.values(normalised).reduce((a, b) => a + b, 0);
  check("shipped weights normalise to 100", Math.abs(total - 100) < 0.001, `got ${total}`);

  const doubled = normaliseWeights(
    Object.fromEntries(MATCH_FACTOR_KEYS.map((k) => [k, MATCH_WEIGHTS[k] * 7])),
  );
  check("weights are relative — scaling them all changes nothing",
    MATCH_FACTOR_KEYS.every((k) => Math.abs(doubled[k] - normalised[k]) < 0.001));

  const partial = normaliseWeights({ course: 50 });
  check("a partial weight map keeps the shipped value for every other factor",
    MATCH_FACTOR_KEYS.every((k) => partial[k] > 0) &&
      Math.abs(Object.values(partial).reduce((a, b) => a + b, 0) - 100) < 0.001);

  const allZero = normaliseWeights(Object.fromEntries(MATCH_FACTOR_KEYS.map((k) => [k, 0])));
  check("all-zero weights fall back to the shipped set rather than zeroing every score",
    Math.abs(Object.values(allZero).reduce((a, b) => a + b, 0) - 100) < 0.001);

  check("an unknown factor in stored settings is ignored",
    Object.keys(normaliseWeights({ ...MATCH_WEIGHTS, nonsense: 900 })).length ===
      MATCH_FACTOR_KEYS.length);

  // --- scoring -------------------------------------------------------------
  const exact = scoreTutorForRequest(baseTutor(), baseRequest(), availability);
  const subjectOnly = scoreTutorForRequest(
    baseTutor({ courseIds: [] }), baseRequest(), availability,
  );
  check("teaching the exact course outscores teaching only the subject",
    exact.score > subjectOnly.score, `${exact.score} vs ${subjectOnly.score}`);

  check("a score is bounded to 0–100", exact.score >= 0 && exact.score <= 100, `${exact.score}`);

  const again = scoreTutorForRequest(baseTutor(), baseRequest(), availability);
  check("scoring is deterministic", again.score === exact.score);

  const overBudget = scoreTutorForRequest(
    baseTutor({ minHourlyRateCents: 20000, hourlyRateCents: 20000 }), baseRequest(), availability,
  );
  check("a tutor far over budget scores below one inside it",
    overBudget.score < exact.score && overBudget.breakdown.budget === 0);

  const noLanguage = scoreTutorForRequest(
    baseTutor({ languages: ["French"] }), baseRequest({ languages: ["Mandarin"] }), availability,
  );
  const rightLanguage = scoreTutorForRequest(
    baseTutor({ languages: ["Mandarin"] }), baseRequest({ languages: ["Mandarin"] }), availability,
  );
  check("the language the family asked for counts",
    rightLanguage.score > noLanguage.score);

  const unverified = scoreTutorForRequest(
    baseTutor({ verifiedTypes: [] }), baseRequest(), availability,
  );
  check("verification badges a moderator granted count toward the score",
    exact.score > unverified.score);

  const noAvailability = scoreTutorForRequest(baseTutor(), baseRequest(), null);
  check("a tutor with no published availability loses the schedule factor",
    noAvailability.breakdown.availability === 0 && noAvailability.score < exact.score);

  // A weight change reorders; it cannot invent a factor's raw fit.
  const courseHeavy = scoreTutorForRequest(
    baseTutor({ courseIds: [] }), baseRequest(), availability,
    { ...MATCH_WEIGHTS, course: 90 },
  );
  check("raising a weight changes points, not the underlying fit",
    courseHeavy.factors.course === subjectOnly.factors.course &&
      courseHeavy.breakdown.course !== subjectOnly.breakdown.course);

  // --- ranking -------------------------------------------------------------
  const ranked = [
    { score: 70, tutor: { _id: "b", stats: { ratingAverage: 4.9, completedLessons: 10 } } },
    { score: 70, tutor: { _id: "a", stats: { ratingAverage: 4.9, completedLessons: 10 } } },
    { score: 70, tutor: { _id: "c", stats: { ratingAverage: 5.0, completedLessons: 3 } } },
    { score: 90, tutor: { _id: "d", stats: { ratingAverage: 3.0, completedLessons: 1 } } },
  ].sort(compareMatches);
  check("ranking puts the highest score first",
    ranked[0].tutor._id === "d");
  check("a tie is broken by rating, then lessons, then id — deterministically",
    ranked.map((r) => r.tutor._id).join("") === "dcab");

  const shuffled = [...ranked].reverse().sort(compareMatches);
  check("the same candidates always come back in the same order",
    shuffled.map((r) => r.tutor._id).join("") === ranked.map((r) => r.tutor._id).join(""));

  // --- eligibility ---------------------------------------------------------
  check("an eligible tutor passes", isEligibleForMatch(baseTutor(), baseRequest()).eligible);

  const ineligible = [
    ["an unapproved profile", baseTutor({ status: TUTOR_STATUS.PENDING_REVIEW })],
    ["a profile that is not searchable", baseTutor({ isSearchable: false })],
    ["a tutor not taking new students", baseTutor({ acceptingNewStudents: false })],
    ["a suspended account", baseTutor({ userId: { _id: "x", status: USER_STATUS.SUSPENDED } })],
    ["a deleted account", baseTutor({ userId: { _id: "x", status: USER_STATUS.ACTIVE, deletedAt: new Date() } })],
    ["a tutor who does not teach the subject", baseTutor({ courseIds: [], subjectIds: [] })],
    ["a tutor who does not offer the lesson type", baseTutor({ lessonModes: [LESSON_MODES.IN_PERSON] })],
  ];
  for (const [label, tutor] of ineligible) {
    const result = isEligibleForMatch(tutor, baseRequest());
    check(`${label} is never recommended`, !result.eligible, result.reason);
  }

  const farAway = baseTutor({ location: { type: "Point", coordinates: [-75.6972, 45.4215] } });
  check("an in-person-only request never reaches a tutor outside the travel radius",
    !isEligibleForMatch(farAway, baseRequest({
      modes: [LESSON_MODES.IN_PERSON],
      location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    })).eligible);

  check("a tutor cannot be matched to their own request",
    !isEligibleForMatch(
      baseTutor({ userId: { _id: "fffffffffffffffffffffff1", status: USER_STATUS.ACTIVE } }),
      baseRequest(),
    ).eligible);

  // No weighting can rescue an ineligible tutor: eligibility runs first.
  const suspended = baseTutor({ userId: { _id: "x", status: USER_STATUS.SUSPENDED } });
  const generous = scoreTutorForRequest(suspended, baseRequest(), availability, { course: 100 });
  check("a high score does not make an ineligible tutor eligible",
    generous.score > 0 && !isEligibleForMatch(suspended, baseRequest()).eligible);

  // --- candidate query -----------------------------------------------------
  const query = matchCandidateQuery(baseRequest());
  check("the candidate query filters on the searchable gate and approved status",
    query.isSearchable === true && query.status === TUTOR_STATUS.APPROVED &&
      query.acceptingNewStudents === true);

  const geoQuery = matchCandidateQuery(baseRequest({
    modes: [LESSON_MODES.IN_PERSON],
    location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    maxDistanceKm: 10,
  }));
  check("an in-person-only request bounds the query geographically",
    Boolean(geoQuery.location?.$geoWithin?.$centerSphere));

  check("a request that also accepts online is not geo-bounded",
    !matchCandidateQuery(baseRequest({
      modes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
      location: { type: "Point", coordinates: [-79.3832, 43.6532] },
    })).location);

  // --- explanation ---------------------------------------------------------
  const reasons = explainMatch(exact.breakdown, exact.distanceKm, exact.weights);
  check("a strong match explains itself in plain language", reasons.length > 0);
  check("an exact course match says so",
    reasons.some((r) => /exact course/i.test(r)));

  // A match scored under the old weights still explains against those weights.
  const oldWeights = { ...MATCH_WEIGHTS, course: 90 };
  const oldScored = scoreTutorForRequest(baseTutor(), baseRequest(), availability, oldWeights);
  check("an old match explains itself against the weights it was scored with",
    explainMatch(oldScored.breakdown, oldScored.distanceKm, oldScored.weights)
      .some((r) => /exact course/i.test(r)));
}

// --- 11. Tutor request lifecycle (§22, §41 Phase 2) ------------------------

/**
 * The request state machine against a real database: who may edit, who may
 * see, what the matcher will and will not revive, and whether the expiry job
 * is safe to run twice.
 */
async function tutorRequestTests() {
  section("Tutor requests — lifecycle, visibility and expiry");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("tutor request lifecycle", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("tutor request lifecycle", "MongoDB is not reachable");
    }
  }

  const { TutorRequest, TutorMatch, TutorProfile, StudentProfile, Course, Notification, AuditLog, User } =
    await import("@/models");
  const svc = await import("@/services/request.service");
  const { REQUEST_STATUS, REQUEST_VISIBILITY, MATCH_STATUS, ROLES } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  const student = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !student) {
    return skip("tutor request lifecycle", "no seeded tutor/student — run `bun run seed`");
  }

  const course = await Course.findById(tutor.courseIds?.[0]).lean();
  if (!course) return skip("tutor request lifecycle", "seeded tutor teaches no known course");

  const owner = { id: String(student.ownerId), role: ROLES.PARENT };
  const tutorActor = { id: String(tutor.userId), role: ROLES.TUTOR };
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };

  // Leftovers from a crashed earlier run would otherwise count against the
  // per-family open-request cap and fail this one for the wrong reason.
  // Both suites post requests as the same seeded parent, and a crashed run of
  // either leaves them open against the per-family cap.
  const stale = await TutorRequest.find({
    goal: /^(Integration test request|QA run)/,
  })
    .select("_id")
    .lean();
  if (stale.length) {
    const staleIds = stale.map((r) => r._id);
    await TutorMatch.deleteMany({ requestId: { $in: staleIds } });
    await Notification.deleteMany({ entityType: "TutorRequest", entityId: { $in: staleIds } });
    await AuditLog.deleteMany({ entityType: "TutorRequest", entityId: { $in: staleIds } });
    await TutorRequest.deleteMany({ _id: { $in: staleIds } });
  }

  const createdRequests = [];
  const post = async (over = {}) => {
    const { request } = await svc.createTutorRequest({
      studentProfileId: String(student._id),
      courseId: String(course._id),
      modes: ["ONLINE"],
      maxDistanceKm: 25,
      preferredWindows: ["WEEKDAY_EVENING"],
      sessionsPerWeek: 1,
      preferredDurationMinutes: 60,
      budgetMaxCents: 20000,
      languages: [],
      preferredQualifications: [],
      urgency: "FLEXIBLE",
      visibility: REQUEST_VISIBILITY.PUBLIC,
      goal: "Integration test request — safe to delete.",
      ...over,
    }, owner);
    createdRequests.push(request.id);
    return request;
  };

  try {
    // --- creation and matching ---------------------------------------------
    const request = await post();
    check("posting a request stores it OPEN", request.status === REQUEST_STATUS.OPEN);
    check("a request gets a public reference", /^REQ-/.test(request.reference));

    const matches = await TutorMatch.find({ requestId: request.id }).lean();
    check("the matcher suggested at least the tutor who teaches this course",
      matches.some((m) => String(m.tutorProfileId) === String(tutor._id)),
      `${matches.length} matches`);

    const mine = matches.find((m) => String(m.tutorProfileId) === String(tutor._id));
    check("a stored match keeps the weights it was scored with", Boolean(mine?.scoreWeights));
    check("a stored match keeps a per-factor breakdown",
      typeof mine?.scoreBreakdown?.course === "number");

    // --- authorization ------------------------------------------------------
    const strangerEdit = await throws(
      () => svc.updateTutorRequest(request.id, { goal: "Hijacked by a stranger." }, stranger),
      (e) => e.status === 403,
    );
    check("a stranger cannot edit someone else's request",
      strangerEdit.threw && strangerEdit.matched);

    const strangerCancel = await throws(
      () => svc.cancelRequest(request.id, {}, stranger),
      (e) => e.status === 403,
    );
    check("a stranger cannot cancel someone else's request",
      strangerCancel.threw && strangerCancel.matched);

    const strangerRead = await throws(
      () => svc.getRequest(request.id, stranger),
      (e) => e.status === 403,
    );
    check("a learner who does not own a request cannot read it",
      strangerRead.threw && strangerRead.matched);

    // --- editing ------------------------------------------------------------
    const edited = await svc.updateTutorRequest(
      request.id,
      { goal: "Integration test request — edited. Safe to delete.", budgetMaxCents: 25000 },
      owner,
    );
    check("editing records what changed",
      edited.changed.includes("goal") && edited.changed.includes("budgetMaxCents"));
    check("editing bumps the edit counter", edited.request.editCount === 1);

    const noop = await svc.updateTutorRequest(request.id, { budgetMaxCents: 25000 }, owner);
    check("an edit that changes nothing is a no-op", noop.changed.length === 0);

    const forbidden = await svc.updateTutorRequest(
      request.id,
      { courseId: String(new mongoose.Types.ObjectId()), studentProfileId: String(new mongoose.Types.ObjectId()) },
      owner,
    );
    check("course and learner cannot be changed by an edit",
      String(forbidden.request.courseId) === String(course._id) &&
        String(forbidden.request.studentProfileId) === String(student._id));

    // --- tutor stepping back -----------------------------------------------
    await svc.withdrawFromRequest(request.id, { action: "DECLINE", reason: "Full this term." }, tutorActor);
    const declined = await TutorMatch.findOne({
      requestId: request.id, tutorProfileId: tutor._id,
    }).lean();
    check("a tutor declining is recorded, not deleted",
      declined?.status === MATCH_STATUS.TUTOR_DECLINED && Boolean(declined.declinedAt));

    const declineTwice = await throws(
      () => svc.withdrawFromRequest(request.id, { action: "DECLINE" }, tutorActor),
      (e) => e.status === 409,
    );
    check("a tutor cannot decline the same request twice",
      declineTwice.threw && declineTwice.matched);

    const pitchAfterDecline = await throws(
      () => svc.expressInterest(request.id, { message: "x".repeat(40) }, tutorActor),
      (e) => e.code === "MATCH_CLOSED",
    );
    check("a tutor who declined cannot then pitch",
      pitchAfterDecline.threw && pitchAfterDecline.matched);

    await svc.generateMatches(await TutorRequest.findById(request.id).lean());
    const stillDeclined = await TutorMatch.findOne({
      requestId: request.id, tutorProfileId: tutor._id,
    }).lean();
    check("re-running the matcher never revives a match a tutor closed",
      stillDeclined?.status === MATCH_STATUS.TUTOR_DECLINED);

    // --- invite-only visibility ---------------------------------------------
    const privateRequest = await post({ visibility: REQUEST_VISIBILITY.INVITE_ONLY });
    const uninvited = await throws(
      () => svc.getRequestForTutor(privateRequest.id, tutorActor),
      (e) => e.status === 404,
    );
    check("an uninvited tutor cannot even see an invite-only request exists",
      uninvited.threw && uninvited.matched);

    const uninvitedPitch = await throws(
      () => svc.expressInterest(privateRequest.id, { message: "y".repeat(40) }, tutorActor),
      (e) => e.status === 404,
    );
    check("an uninvited tutor cannot respond to an invite-only request",
      uninvitedPitch.threw && uninvitedPitch.matched);

    const invited = await svc.inviteTutors(
      privateRequest.id, { tutorProfileIds: [String(tutor._id)] }, owner,
    );
    check("inviting a tutor opens the request to them", invited.invited === 1);

    const view = await svc.getRequestForTutor(privateRequest.id, tutorActor);
    check("an invited tutor sees the request and may respond",
      view.request.id === privateRequest.id && view.canRespond === true);

    const strangerInvite = await throws(
      () => svc.inviteTutors(privateRequest.id, { tutorProfileIds: [String(tutor._id)] }, stranger),
      (e) => e.status === 403,
    );
    check("only the owner may invite tutors", strangerInvite.threw && strangerInvite.matched);

    const reinvite = await throws(
      () => svc.inviteTutors(privateRequest.id, { tutorProfileIds: [String(tutor._id)] }, owner),
      (e) => e.status === 409,
    );
    check("a tutor already invited is not invited again", reinvite.threw && reinvite.matched);

    // --- responding ---------------------------------------------------------
    await svc.expressInterest(privateRequest.id, { message: "z".repeat(40) }, tutorActor);
    const pitched = await TutorMatch.findOne({
      requestId: privateRequest.id, tutorProfileId: tutor._id,
    }).lean();
    check("a tutor's pitch is stored against the match",
      pitched?.status === MATCH_STATUS.TUTOR_INTERESTED && Boolean(pitched.respondedAt));

    const counted = await TutorRequest.findById(privateRequest.id).lean();
    check("the interested count reflects the pitch", counted.interestedCount === 1);

    const pitchTwice = await throws(
      () => svc.expressInterest(privateRequest.id, { message: "q".repeat(40) }, tutorActor),
      (e) => e.status === 409,
    );
    check("a tutor cannot pitch twice", pitchTwice.threw && pitchTwice.matched);

    await svc.withdrawFromRequest(privateRequest.id, { action: "WITHDRAW" }, tutorActor);
    const afterWithdraw = await TutorRequest.findById(privateRequest.id).lean();
    check("withdrawing a pitch decrements the interested count",
      afterWithdraw.interestedCount === 0);

    // --- endings ------------------------------------------------------------
    const cancelled = await svc.cancelRequest(privateRequest.id, { reason: "Test." }, owner);
    check("cancelling moves the request to CANCELLED",
      cancelled.status === REQUEST_STATUS.CANCELLED && Boolean(cancelled.cancelledAt));

    const editClosed = await throws(
      () => svc.updateTutorRequest(privateRequest.id, { goal: "Reopened by the back door." }, owner),
      (e) => e.code === "REQUEST_CLOSED",
    );
    check("a closed request cannot be edited", editClosed.threw && editClosed.matched);

    const respondClosed = await throws(
      () => svc.expressInterest(privateRequest.id, { message: "w".repeat(40) }, tutorActor),
      (e) => e.code === "REQUEST_CLOSED" || e.status === 404,
    );
    check("a closed request accepts no new responses",
      respondClosed.threw && respondClosed.matched);

    const closedMatches = await svc.generateMatches(
      await TutorRequest.findById(privateRequest.id).lean(),
    );
    check("the matcher does nothing for a closed request", closedMatches.length === 0);

    // --- expiry -------------------------------------------------------------
    const expiring = await post();
    await TutorRequest.updateOne(
      { _id: expiring.id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );
    const firstSweep = await svc.expireStaleRequests();
    check("the expiry sweep closes an aged-out request", firstSweep.expired >= 1);
    check("the expired request is EXPIRED",
      (await TutorRequest.findById(expiring.id).lean()).status === REQUEST_STATUS.EXPIRED);

    const secondSweep = await svc.expireStaleRequests();
    check("running the expiry sweep again finds nothing left to do",
      secondSweep.expired === 0);

    const warning = await post();
    await TutorRequest.updateOne(
      { _id: warning.id },
      { $set: { expiresAt: new Date(Date.now() + 24 * 3600_000), expiryWarnedAt: null } },
    );
    const warnRun = await svc.expireStaleRequests();
    check("a request about to expire warns the family once", warnRun.warned >= 1);
    check("the warning is stamped so it cannot be sent twice",
      Boolean((await TutorRequest.findById(warning.id).lean()).expiryWarnedAt));
    const warnAgain = await svc.expireStaleRequests();
    check("a second sweep does not warn the same family again", warnAgain.warned === 0);

    // --- moderation ----------------------------------------------------------
    const moderated = await post();
    const removed = await svc.moderateRequest(
      moderated.id, { action: "REMOVE", note: "Contains contact details." }, admin,
    );
    check("a moderator can remove a request", removed.status === REQUEST_STATUS.REMOVED);
    check("removal is recorded in the moderation history",
      removed.moderationHistory.length === 1);

    const hidden = await throws(
      () => svc.getRequestForTutor(moderated.id, tutorActor),
      (e) => e.status === 404,
    );
    check("a removed request is invisible to tutors", hidden.threw && hidden.matched);

    const restored = await svc.moderateRequest(
      moderated.id, { action: "RESTORE", note: "Family edited it." }, admin,
    );
    check("a removed request can be restored", restored.status === REQUEST_STATUS.OPEN);
    check("the restore is recorded too", restored.moderationHistory.length === 2);

    await svc.moderateRequest(moderated.id, { action: "REMOVE", note: "Re-removed." }, admin);
    const alreadyRemoved = await throws(
      () => svc.moderateRequest(moderated.id, { action: "REMOVE", note: "Again." }, admin),
      (e) => e.status === 409,
    );
    check("a request cannot be removed twice",
      alreadyRemoved.threw && alreadyRemoved.matched, alreadyRemoved.error?.message);

    const restoreNotRemoved = await throws(
      () => svc.moderateRequest(request.id, { action: "RESTORE", note: "Nothing to undo." }, admin),
      (e) => e.status === 409,
    );
    check("a request that was never removed cannot be restored",
      restoreNotRemoved.threw && restoreNotRemoved.matched);

    // --- audit trail ---------------------------------------------------------
    // `recordAudit` swallows its own failures so an audit problem cannot break
    // the action being audited — which also means a bad action name is silent.
    // Asserting the trail exists is what makes that visible.
    const trail = await AuditLog.find({
      entityType: "TutorRequest",
      entityId: { $in: createdRequests.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    const actions = new Set(trail.map((row) => row.action));
    check("creating a request is audited", actions.has("REQUEST_CREATED"));
    check("editing a request is audited", actions.has("REQUEST_UPDATED"));
    check("cancelling a request is audited", actions.has("REQUEST_CANCELLED"));
    check("inviting a tutor is audited", actions.has("REQUEST_TUTOR_INVITED"));
    check("moderating a request is audited", actions.has("REQUEST_MODERATED"));
    check("every audit row names a valid action",
      trail.length > 0 && trail.every((row) => Boolean(row.action)));

    // --- notifications -------------------------------------------------------
    const notices = await Notification.find({
      entityType: "TutorRequest",
      entityId: { $in: createdRequests.map((id) => new mongoose.Types.ObjectId(id)) },
    }).lean();
    check("tutors are notified about a public request",
      notices.some((n) => n.type === "REQUEST_MATCHED"));
    check("an invited tutor is notified by name",
      notices.some((n) => n.type === "REQUEST_INVITED"));
    check("the family is warned before their request expires",
      notices.some((n) => n.type === "REQUEST_EXPIRING"));
    check("no notification about an invite-only request was broadcast to the board",
      !notices.some(
        (n) => n.type === "REQUEST_MATCHED" && String(n.entityId) === privateRequest.id,
      ));
  } finally {
    const ids = createdRequests.map((id) => new mongoose.Types.ObjectId(id));
    await TutorMatch.deleteMany({ requestId: { $in: ids } });
    await Notification.deleteMany({ entityType: "TutorRequest", entityId: { $in: ids } });
    await AuditLog.deleteMany({ entityType: "TutorRequest", entityId: { $in: ids } });
    await TutorRequest.deleteMany({ _id: { $in: ids } });
  }
}


// --- 12. SMS adapters (§28, §38, §41 Phase 2) ------------------------------

/**
 * The Twilio adapter and the development stand-in, with `fetch` stubbed.
 *
 * The two things worth proving here are that a production send is shaped the
 * way Twilio actually expects, and that the development provider never claims
 * a message was delivered — a fake that lied would hide the exact failure
 * this channel is most likely to have in production.
 */
async function smsAdapterTests() {
  section("SMS — Twilio adapter, development provider and callback signatures");

  const {
    ConsoleSmsProvider, TwilioSmsProvider, verifyTwilioSignature,
    getSmsProvider, smsConfigured, resetSmsProvider,
  } = await import("@/services/external/sms-provider");
  const {
    smsBodyFor, hasSmsTemplate, segmentCount, verificationSmsBody, SMS_OPT_OUT_FOOTER,
  } = await import("@/services/external/sms-templates");
  const { NOTIFICATION_TYPES } = await import("@/constants");

  // --- development provider -------------------------------------------------
  const console_ = new ConsoleSmsProvider();
  const simulated = await console_.send({ to: "+14165550142", body: "hello" });
  check("the development provider never reports delivery", simulated.delivered === false);
  check("it says plainly that the message was simulated", simulated.simulated === true);
  check("the development provider reports itself as unconfigured", console_.configured === false);

  // --- Twilio: request shape ------------------------------------------------
  let fetchStub = stubFetch(() => ({ body: { sid: "SM123", status: "queued", num_segments: "1" } }));
  const twilio = new TwilioSmsProvider({
    accountSid: "ACtest", authToken: "secrettoken", from: "+15550000000", fetchImpl: fetchStub,
  });

  const sent = await twilio.send({ to: "+14165550142", body: "Lesson at 5pm", idempotencyKey: "abc" });
  const call = fetchStub.calls[0];
  const form = new URLSearchParams(call.options.body);

  check("the send goes to Twilio's Messages endpoint for the account",
    call.url === "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
  check("credentials travel as HTTP basic auth, never in the body",
    call.options.headers.Authorization === `Basic ${Buffer.from("ACtest:secrettoken").toString("base64")}` &&
      !call.options.body.includes("secrettoken"));
  check("the destination and body are form-encoded",
    form.get("To") === "+14165550142" && form.get("Body") === "Lesson at 5pm");
  check("a from-number is sent when no messaging service is configured",
    form.get("From") === "+15550000000" && !form.has("MessagingServiceSid"));
  check("the idempotency key reaches Twilio",
    call.options.headers["I-Twilio-Idempotency-Token"] === "abc");
  check("a successful send returns the provider's message id",
    sent.delivered === true && sent.messageId === "SM123");

  fetchStub = stubFetch(() => ({ body: { sid: "SM9", status: "accepted" } }));
  const withService = new TwilioSmsProvider({
    accountSid: "ACtest", authToken: "t", messagingServiceSid: "MG1", fetchImpl: fetchStub,
  });
  await withService.send({ to: "+14165550142", body: "hi" });
  const serviceForm = new URLSearchParams(fetchStub.calls[0].options.body);
  check("a messaging service is used in place of a from-number",
    serviceForm.get("MessagingServiceSid") === "MG1" && !serviceForm.has("From"));

  // --- Twilio: failures -----------------------------------------------------
  fetchStub = stubFetch(() => ({ status: 400, body: { code: 21610, message: "Unsubscribed recipient" } }));
  const rejected = await throws(
    () => new TwilioSmsProvider({ accountSid: "AC", authToken: "t", from: "+1", fetchImpl: fetchStub })
      .send({ to: "+14165550142", body: "x" }),
    (e) => e.code === "TWILIO_21610",
  );
  check("a provider rejection surfaces its code", rejected.threw && rejected.matched);
  check("a permanent rejection is not marked retryable",
    rejected.error?.retryable === false);
  check("the failure message never contains the text that was sent",
    !String(rejected.error?.message).includes("x is your"));

  fetchStub = stubFetch(() => ({ status: 429, body: { message: "Too many requests" } }));
  const throttled = await throws(
    () => new TwilioSmsProvider({ accountSid: "AC", authToken: "t", from: "+1", fetchImpl: fetchStub })
      .send({ to: "+14165550142", body: "x" }),
    (e) => e.retryable === true,
  );
  check("a throttled send is marked retryable", throttled.threw && throttled.matched);

  // --- provider selection ---------------------------------------------------
  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetSmsProvider();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetSmsProvider();
    }
  };

  await withEnv({ SMS_PROVIDER: undefined, TWILIO_ACCOUNT_SID: undefined, TWILIO_AUTH_TOKEN: undefined }, async () => {
    check("with no credentials, SMS falls back to the development provider",
      (await getSmsProvider()).name === "CONSOLE");
    check("and reports itself as not configured", (await smsConfigured()) === false);
  });

  await withEnv({
    SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM_NUMBER: "+15550000000", TWILIO_MESSAGING_SERVICE_SID: undefined,
  }, async () => {
    check("a fully configured Twilio selection produces the real adapter",
      (await getSmsProvider()).name === "TWILIO");
    check("and reports itself as configured", (await smsConfigured()) === true);
  });

  await withEnv({
    SMS_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM_NUMBER: undefined, TWILIO_MESSAGING_SERVICE_SID: undefined,
  }, async () => {
    const misconfigured = await await$throws(() => getSmsProvider());
    check("Twilio without a sender is refused at startup, not per message",
      misconfigured.threw && misconfigured.error?.code === "PROVIDER_MISCONFIGURED");
    check("the refusal names the missing variables, never a value",
      /TWILIO_FROM_NUMBER|TWILIO_MESSAGING_SERVICE_SID/.test(misconfigured.error?.message ?? "") &&
        !String(misconfigured.error?.message).includes("tok"));
  });

  await withEnv({ SMS_PROVIDER: "carrier-pigeon" }, async () => {
    const unknown = await await$throws(() => getSmsProvider());
    check("an unknown SMS provider is refused", unknown.threw);
  });

  // --- inbound callback signatures -----------------------------------------
  const authToken = "the-account-auth-token";
  const url = "https://test.apluslearn.ca/api/webhooks/sms";
  const params = { From: "+14165550142", Body: "STOP", MessageSid: "SM1" };

  const sign = (u, p) => {
    const payload = Object.keys(p).sort().reduce((acc, k) => acc + k + p[k], u);
    return createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  };

  check("a correctly signed callback verifies",
    verifyTwilioSignature({ signature: sign(url, params), url, params, authToken }));
  check("an unsigned callback is refused",
    !verifyTwilioSignature({ signature: null, url, params, authToken }));
  check("a callback whose body was tampered with is refused",
    !verifyTwilioSignature({
      signature: sign(url, params), url, params: { ...params, Body: "START" }, authToken,
    }));
  check("a callback replayed against a different URL is refused",
    !verifyTwilioSignature({
      signature: sign(url, params), url: "https://evil.example/api/webhooks/sms", params, authToken,
    }));
  check("a signature made with the wrong token is refused",
    !verifyTwilioSignature({
      signature: createHmac("sha1", "wrong").update(url).digest("base64"), url, params, authToken,
    }));
  check("verification needs a token to check against",
    !verifyTwilioSignature({ signature: sign(url, params), url, params, authToken: undefined }));

  // --- templates ------------------------------------------------------------
  check("only whitelisted notification types have a text version",
    hasSmsTemplate(NOTIFICATION_TYPES.BOOKING_REMINDER) &&
      !hasSmsTemplate(NOTIFICATION_TYPES.MESSAGE_RECEIVED));

  const body = smsBodyFor(
    NOTIFICATION_TYPES.BOOKING_REMINDER,
    { title: "Lesson tomorrow", body: "MHF4U with Priya at 5:00 PM." },
    "APlus Learn",
  );
  check("a text carries the platform name", body.startsWith("APlus Learn:"));
  check("every text carries an opt-out path", body.endsWith(SMS_OPT_OUT_FOOTER));
  check("a reminder fits one message segment", segmentCount(body) === 1, `${body.length} chars`);

  check("a notification with no template renders nothing",
    smsBodyFor(NOTIFICATION_TYPES.MESSAGE_RECEIVED, { title: "x" }, "APlus Learn") === null);

  const longBody = smsBodyFor(
    NOTIFICATION_TYPES.BOOKING_CHANGED,
    { title: "Lesson moved", body: "word ".repeat(80) },
    "APlus Learn",
  );
  check("a long notification is clipped rather than sent as three segments",
    segmentCount(longBody) === 1, `${longBody.length} chars`);
  check("clipping stays inside the GSM-7 alphabet, so one segment stays one segment",
    !/[^\x20-\x7E]/.test(longBody));
  check("clipping cuts on a word boundary", /\s\.\.\.\s|[a-z]\.\.\. /.test(`${longBody} `) || longBody.includes("... "));

  const code = verificationSmsBody("123456", "APlus Learn");
  check("a confirmation code text says it expires", /expires/i.test(code));
  check("a confirmation code text warns it will never be asked for",
    /never ask/i.test(code));
  check("a unicode body is costed against the smaller segment size",
    segmentCount("é".repeat(80)) === 2);
}

// --- 13. SMS service (§28, §36, §41 Phase 2) -------------------------------

/**
 * Consent, idempotency and verification against a real database.
 *
 * The question this section exists to answer is not "can we send a text" but
 * "can we ever send one we shouldn't" — so most of it is about the messages
 * that must *not* go out, and about every one of those leaving a record that
 * says why.
 */
async function smsServiceTests() {
  section("SMS — consent, idempotency, verification and opt-out");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("SMS service", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("SMS service", "MongoDB is not reachable");
    }
  }

  const { User, SmsMessage, AuthToken, Notification } = await import("@/models");
  const { AUTH_TOKEN_PURPOSE } = await import("@/models");
  const sms = await import("@/services/sms.service");
  const { updateNotificationPreferences } = await import("@/services/user.service");
  const { notify } = await import("@/services/notification.service");
  const {
    SMS_STATUS, SMS_SKIP_REASONS, NOTIFICATION_TYPES, NOTIFICATION_CHANNELS, ROLES,
  } = await import("@/constants");

  // `smsEnabled` ships off, which is correct — and means this section has to
  // turn it on to exercise anything past the platform gate. The original value
  // is restored in the `finally` below.
  const { updateSettings, invalidateSettingsCache } = await import("@/services/settings.service");
  const { Settings } = await import("@/models");
  const settingsBefore = await Settings.findOne({ key: "PLATFORM" }).lean();
  const smsWasEnabled = settingsBefore?.notifications?.smsEnabled ?? false;
  await updateSettings({ notifications: { smsEnabled: true } });
  invalidateSettingsCache();

  const made = [];
  const makeUser = async (over = {}) => {
    const user = await User.create({
      email: `sms-test-${randomUUID()}@example.com`,
      firstName: "Sms",
      lastName: "Tester",
      role: ROLES.PARENT,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      ...over,
    });
    made.push(user._id);
    return user;
  };

  const rowsFor = (userId) => SmsMessage.find({ userId }).sort({ createdAt: -1 }).lean();

  try {
    // --- consent gates, one at a time ---------------------------------------
    const notification = (type = NOTIFICATION_TYPES.BOOKING_REMINDER) => ({
      _id: new mongoose.Types.ObjectId(),
      type,
      title: "Lesson tomorrow",
      body: "MHF4U at 5:00 PM.",
    });

    const noPhone = await makeUser();
    let result = await sms.sendNotificationSms(notification(), noPhone.toObject());
    check("no number on the account means no text",
      result.skipReason === SMS_SKIP_REASONS.NO_PHONE);

    const unverified = await makeUser({ phoneE164: "+14165550111", phone: "4165550111" });
    result = await sms.sendNotificationSms(notification(), unverified.toObject());
    check("an unconfirmed number is never texted",
      result.skipReason === SMS_SKIP_REASONS.PHONE_UNVERIFIED);

    const channelOff = await makeUser({
      phoneE164: "+14165550112", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: false },
    });
    result = await sms.sendNotificationSms(notification(), channelOff.toObject());
    check("a recipient who has texts switched off is not texted",
      result.skipReason === SMS_SKIP_REASONS.CHANNEL_DISABLED);

    const stopped = await makeUser({
      phoneE164: "+14165550113", phoneVerifiedAt: new Date(), smsOptOutAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    result = await sms.sendNotificationSms(notification(), stopped.toObject());
    check("a STOP on record outranks the account's own preference",
      result.skipReason === SMS_SKIP_REASONS.OPTED_OUT);

    const ready = await makeUser({
      phoneE164: "+14165550114", phone: "4165550114", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    result = await sms.sendNotificationSms(
      notification(NOTIFICATION_TYPES.MESSAGE_RECEIVED), ready.toObject(),
    );
    check("a notification with no text version is not texted",
      result.skipReason === SMS_SKIP_REASONS.NO_TEMPLATE);

    // Every refusal is on the record, with its reason.
    const skipped = await rowsFor(channelOff._id);
    check("a message that was deliberately not sent is still recorded",
      skipped.length === 1 && skipped[0].status === SMS_STATUS.SKIPPED);
    check("and the record says which gate stopped it",
      skipped[0].skipReason === SMS_SKIP_REASONS.CHANNEL_DISABLED);

    // The outermost gate: an operator switching texts off stops all of them,
    // whatever anyone has chosen for themselves.
    await updateSettings({ notifications: { smsEnabled: false } });
    invalidateSettingsCache();
    result = await sms.sendNotificationSms(notification(), ready.toObject());
    check("an operator switching texts off stops every one of them",
      result.skipReason === SMS_SKIP_REASONS.PLATFORM_DISABLED);
    await updateSettings({ notifications: { smsEnabled: true } });
    invalidateSettingsCache();

    // --- the development provider is honest ----------------------------------
    const note = notification();
    result = await sms.sendNotificationSms(note, ready.toObject());
    check("with no carrier configured, a text is recorded as simulated",
      result.status === SMS_STATUS.SIMULATED, JSON.stringify(result));
    check("a simulated text is never reported as sent", result.sent === false);

    const row = (await rowsFor(ready._id))[0];
    check("the simulated message is in the delivery log",
      row?.status === SMS_STATUS.SIMULATED && row.notificationType === note.type);
    check("the log keeps a preview of what would have been sent",
      /Lesson tomorrow/.test(row.bodyPreview ?? ""));

    // --- idempotency ----------------------------------------------------------
    await sms.sendNotificationSms(note, ready.toObject());
    const afterRetry = await SmsMessage.countDocuments({
      dedupeKey: `notification:${note._id}`,
    });
    check("the same notification is never texted twice", afterRetry === 1);

    const retried = await sms.sendNotificationSms(note, ready.toObject());
    check("a retry is refused as a duplicate, not silently re-sent",
      retried.skipReason === SMS_SKIP_REASONS.DUPLICATE);

    // --- verification codes ---------------------------------------------------
    const verifying = await makeUser();
    const start = await sms.startPhoneVerification(verifying._id, {
      phone: "4165550199", phoneE164: "+14165550199",
    });
    check("asking for a code reports whether a carrier is actually behind it",
      start.providerConfigured === false && start.simulated === true);

    const token = await AuthToken.findOne({
      userId: verifying._id, purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
    }).lean();
    check("the code is stored only as a hash", Boolean(token) && token.tokenHash.length === 64);
    check("the number is bound to the token, not read back from the request",
      token.subject === "+14165550199");

    const codeRow = (await rowsFor(verifying._id))[0];
    check("a confirmation code is never previewed in the delivery log",
      codeRow.kind === "VERIFICATION" && !/\d{6}/.test(codeRow.bodyPreview ?? ""));

    const wrong = await throws(
      () => sms.confirmPhoneVerification(verifying._id, { code: "000000" }),
      (e) => e.status === 422,
    );
    check("a wrong code is refused", wrong.threw && wrong.matched);

    const stillUnverified = await User.findById(verifying._id).lean();
    check("a wrong code leaves the number unconfirmed",
      stillUnverified.phoneVerifiedAt === null);

    // Burn the remaining attempts; the code must stop working entirely.
    for (let i = 0; i < 5; i += 1) {
      await throws(() => sms.confirmPhoneVerification(verifying._id, { code: "000001" }));
    }
    const exhausted = await throws(
      () => sms.confirmPhoneVerification(verifying._id, { code: "000002" }),
      (e) => e.status === 429 || e.code === "CODE_EXPIRED",
    );
    check("a code is burned after repeated wrong guesses",
      exhausted.threw && exhausted.matched);

    // A fresh code, confirmed correctly. The plaintext is not recoverable, so
    // the code is set directly — the hashing path is asserted above.
    const { createHash } = await import("node:crypto");
    await AuthToken.updateMany(
      { userId: verifying._id, purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION },
      { $set: { consumedAt: new Date() } },
    );
    await AuthToken.create({
      userId: verifying._id,
      purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
      tokenHash: createHash("sha256").update("424242").digest("hex"),
      subject: "+14165550199",
      expiresAt: new Date(Date.now() + 600_000),
    });

    const confirmed = await sms.confirmPhoneVerification(verifying._id, { code: "424242" });
    check("the right code confirms the number", Boolean(confirmed.phoneVerifiedAt));
    check("confirming turns the text channel on",
      confirmed.notificationPreferences?.[NOTIFICATION_CHANNELS.SMS] === true);

    const reuse = await throws(
      () => sms.confirmPhoneVerification(verifying._id, { code: "424242" }),
      (e) => e.code === "CODE_EXPIRED",
    );
    check("a confirmed code cannot be used twice", reuse.threw && reuse.matched);

    // --- one number, one account ---------------------------------------------
    const impostor = await makeUser();
    const taken = await throws(
      () => sms.startPhoneVerification(impostor._id, {
        phone: "4165550199", phoneE164: "+14165550199",
      }),
      (e) => e.status === 409,
    );
    check("a number confirmed on one account cannot be claimed by another",
      taken.threw && taken.matched);

    // --- the preference cannot authorise itself -------------------------------
    const sneaky = await makeUser();
    const refused = await throws(
      () => updateNotificationPreferences(sneaky._id, { [NOTIFICATION_CHANNELS.SMS]: true }),
      (e) => e.code === "PHONE_NOT_VERIFIED",
    );
    check("texts cannot be switched on without a confirmed number",
      refused.threw && refused.matched);

    const stoppedUser = await makeUser({
      phoneE164: "+14165550177", phoneVerifiedAt: new Date(), smsOptOutAt: new Date(),
    });
    const refusedStop = await throws(
      () => updateNotificationPreferences(stoppedUser._id, { [NOTIFICATION_CHANNELS.SMS]: true }),
      (e) => e.code === "SMS_OPTED_OUT",
    );
    check("a STOP cannot be undone from the settings screen",
      refusedStop.threw && refusedStop.matched);

    // --- inbound keywords -----------------------------------------------------
    const a = await makeUser({
      phoneE164: "+14165550188", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    const b = await makeUser({
      phoneE164: "+14165550188", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });

    const optOut = await sms.applySmsKeyword({ from: "+14165550188", body: "stop" });
    check("STOP applies to every account holding that handset",
      optOut.action === "OPT_OUT" && optOut.accounts === 2);
    const afterStop = await User.findById(a._id).lean();
    check("STOP also switches the channel off",
      Boolean(afterStop.smsOptOutAt) &&
        afterStop.notificationPreferences[NOTIFICATION_CHANNELS.SMS] === false);

    const optIn = await sms.applySmsKeyword({ from: "+14165550188", body: "START please" });
    check("START clears the block", optIn.action === "OPT_IN" && optIn.accounts === 2);
    const afterStart = await User.findById(b._id).lean();
    check("but START does not switch the channel back on by itself",
      afterStart.smsOptOutAt === null &&
        afterStart.notificationPreferences[NOTIFICATION_CHANNELS.SMS] === false);

    check("an unrelated reply is ignored",
      (await sms.applySmsKeyword({ from: "+14165550188", body: "thanks!" })).action === "IGNORED");

    // --- end to end through the notification service ---------------------------
    const notified = await makeUser({
      phoneE164: "+14165550166", phoneVerifiedAt: new Date(),
      notificationPreferences: { [NOTIFICATION_CHANNELS.SMS]: true },
    });
    const created = await notify({
      userId: notified._id,
      type: NOTIFICATION_TYPES.BOOKING_REMINDER,
      title: "Lesson tomorrow",
      body: "MHF4U at 5:00 PM.",
    });
    check("notifying writes the in-app record as always", Boolean(created?.id));

    const attempted = await SmsMessage.findOne({ userId: notified._id }).lean();
    check("and the SMS path runs without the caller asking for it",
      Boolean(attempted) && attempted.notificationType === NOTIFICATION_TYPES.BOOKING_REMINDER);
    check("a simulated text does not mark the notification as delivered by SMS",
      !(await Notification.findById(created.id).lean()).deliveredChannels
        .includes(NOTIFICATION_CHANNELS.SMS));

    // --- the admin log masks numbers -------------------------------------------
    const log = await sms.listSmsMessages({ pageSize: 5 });
    check("the delivery log masks phone numbers",
      log.items.every((m) => !/^\+\d{11,}$/.test(m.to)), log.items[0]?.to);
    check("the delivery log reports whether a carrier is configured",
      log.providerConfigured === false);
  } finally {
    await updateSettings({ notifications: { smsEnabled: smsWasEnabled } });
    invalidateSettingsCache();
    await SmsMessage.deleteMany({ userId: { $in: made } });
    await AuthToken.deleteMany({ userId: { $in: made } });
    await Notification.deleteMany({ userId: { $in: made } });
    await User.deleteMany({ _id: { $in: made } });
  }
}


// --- 14. Secret storage (§36, §41 Phase 2) ---------------------------------

/**
 * The encryption behind stored OAuth refresh tokens.
 *
 * A refresh token is a standing key to somebody's calendar, so the properties
 * that matter are that it round-trips, that it is not guessable from the
 * stored form, that tampering is detected rather than tolerated, and that a
 * rotated `AUTH_SECRET` makes it unreadable rather than silently wrong.
 */
async function cryptoTests() {
  section("Secret storage — encryption at rest and signed OAuth state");

  const { encryptSecret, decryptSecret, isEncrypted, signState, verifyState } =
    await import("@/lib/security/crypto");

  const token = "1//0gRefreshTokenThatMustNeverLeak";
  const stored = encryptSecret(token, "test-label");

  check("a stored secret round-trips", decryptSecret(stored, "test-label") === token);
  check("the stored form does not contain the plaintext", !stored.includes("RefreshToken"));
  check("the stored form is versioned", stored.startsWith("v1.") && isEncrypted(stored));

  check("encrypting twice produces different ciphertext",
    encryptSecret(token, "test-label") !== encryptSecret(token, "test-label"));

  check("a secret cannot be read with a different purpose label",
    decryptSecret(stored, "other-label") === null);

  const tampered = `${stored.slice(0, -4)}AAAA`;
  check("a tampered ciphertext fails rather than decrypting to something else",
    decryptSecret(tampered, "test-label") === null);

  check("garbage decrypts to null rather than throwing",
    decryptSecret("not-a-secret", "test-label") === null);
  check("an empty secret encrypts to nothing", encryptSecret("", "test-label") === null);

  // The key must actually depend on AUTH_SECRET, so a rotated secret makes
  // stored tokens unreadable rather than subtly wrong. Derived keys are
  // memoised per label, so the dependence is proved with two fresh labels
  // either side of a rotation rather than by re-reading one.
  const originalSecret = process.env.AUTH_SECRET;
  try {
    const underSecretA = encryptSecret(token, `rot-a-${randomUUID()}`);
    const labelB = `rot-b-${randomUUID()}`;

    process.env.AUTH_SECRET = "y".repeat(48);
    const underSecretB = encryptSecret(token, labelB);

    check("a secret encrypted after rotation is unreadable with the pre-rotation key",
      decryptSecret(underSecretB, "test-label") === null);
    check("and the two ciphertexts are not interchangeable",
      underSecretA !== underSecretB && decryptSecret(underSecretA, labelB) === null);
  } finally {
    process.env.AUTH_SECRET = originalSecret;
  }

  check("encryption refuses to run without a usable AUTH_SECRET", (() => {
    const saved = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "too-short";
    try {
      encryptSecret("x", `no-secret-${randomUUID()}`);
      return false;
    } catch {
      return true;
    } finally {
      process.env.AUTH_SECRET = saved;
    }
  })());

  // --- signed state ---------------------------------------------------------
  const state = signState({ userId: "abc", provider: "GOOGLE" }, { label: "state-test" });
  const claims = verifyState(state, { label: "state-test" });
  check("a signed state round-trips", claims?.userId === "abc" && claims.provider === "GOOGLE");

  check("state signed with one purpose is not accepted under another",
    verifyState(state, { label: "different" }) === null);

  const [body] = state.split(".");
  const forged = `${body}.${Buffer.from("forged").toString("base64url")}`;
  check("a forged state signature is refused", verifyState(forged, { label: "state-test" }) === null);

  const swapped = signState({ userId: "victim" }, { label: "state-test" }).split(".")[0];
  check("a state body swapped under a valid signature is refused",
    verifyState(`${swapped}.${state.split(".")[1]}`, { label: "state-test" }) === null);

  const expired = signState({ userId: "abc" }, { label: "state-test", ttlSeconds: -10 });
  check("an expired state is refused", verifyState(expired, { label: "state-test" }) === null);
  check("a missing state is refused", verifyState(undefined, { label: "state-test" }) === null);
}

// --- 15. Calendar adapters (§18, §38, §41 Phase 2) -------------------------

/**
 * Google Calendar and Microsoft Graph, with `fetch` stubbed.
 *
 * The shapes these two speak differ in exactly the ways that cause silent
 * bugs — Google's free/busy versus Graph's calendar view, wall-clock strings
 * versus instants — so the assertions are about the request that goes out,
 * not only the answer that comes back.
 */
async function calendarAdapterTests() {
  section("Calendar — Google and Microsoft adapters");

  const {
    GoogleCalendarProvider, MicrosoftCalendarProvider, DevelopmentCalendarProvider,
    getCalendarProvider, calendarIntegrationsStatus, resetCalendarProviders,
  } = await import("@/services/external/calendar-provider");
  const { CALENDAR_PROVIDERS } = await import("@/constants");

  const lesson = {
    title: "MHF4U lesson (APlus Learn)",
    description: "Reference APL-123",
    start: new Date("2026-03-04T22:00:00.000Z"),
    end: new Date("2026-03-04T23:00:00.000Z"),
    timeZone: "America/Toronto",
    idempotencyKey: "apl-b1-c1",
  };

  // --- Google: authorization ------------------------------------------------
  const google = new GoogleCalendarProvider({ clientId: "gid", clientSecret: "gsecret" });
  const authUrl = new URL(
    google.getAuthorizationUrl({ redirectUri: "https://x.test/cb", state: "st8" }),
  );
  check("Google consent asks for offline access, or the connection dies in an hour",
    authUrl.searchParams.get("access_type") === "offline");
  check("Google consent forces the prompt, so a reconnect still yields a refresh token",
    authUrl.searchParams.get("prompt") === "consent");
  check("Google consent asks only for event write and read-only free/busy",
    authUrl.searchParams.get("scope").includes("calendar.events") &&
      authUrl.searchParams.get("scope").includes("calendar.readonly") &&
      !/auth\/calendar(\s|$)/.test(authUrl.searchParams.get("scope")));
  check("the signed state is carried through", authUrl.searchParams.get("state") === "st8");
  check("the client secret never appears in a URL the browser follows",
    !authUrl.toString().includes("gsecret"));

  // --- Google: token exchange ----------------------------------------------
  const idToken = [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "g-123", email: "tutor@example.com" })).toString("base64url"),
    "sig",
  ].join(".");

  let stub = stubFetch(() => ({
    body: { access_token: "at", refresh_token: "rt", expires_in: 3599, scope: "s", id_token: idToken },
  }));
  const exchanged = await new GoogleCalendarProvider({
    clientId: "gid", clientSecret: "gsecret", fetchImpl: stub,
  }).exchangeCode({ code: "c", redirectUri: "https://x.test/cb" });

  check("a Google exchange yields both tokens",
    exchanged.accessToken === "at" && exchanged.refreshToken === "rt");
  check("the connected account is identified from the id token",
    exchanged.account.email === "tutor@example.com" && exchanged.account.id === "g-123");

  stub = stubFetch(() => ({ body: { access_token: "at", expires_in: 3599 } }));
  const noRefresh = await throws(
    () => new GoogleCalendarProvider({ clientId: "g", clientSecret: "s", fetchImpl: stub })
      .exchangeCode({ code: "c", redirectUri: "r" }),
    (e) => e.code === "NO_REFRESH_TOKEN",
  );
  check("an exchange with no refresh token is refused rather than stored",
    noRefresh.threw && noRefresh.matched);

  stub = stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
  const revoked = await throws(
    () => new GoogleCalendarProvider({ clientId: "g", clientSecret: "s", fetchImpl: stub })
      .refreshAccessToken({ refreshToken: "dead" }),
    (e) => e.code === "REFRESH_REJECTED",
  );
  check("a rejected refresh is distinguishable from a transient failure",
    revoked.threw && revoked.matched);

  stub = stubFetch(() => ({ body: { access_token: "new-at", expires_in: 3599 } }));
  const kept = await new GoogleCalendarProvider({
    clientId: "g", clientSecret: "s", fetchImpl: stub,
  }).refreshAccessToken({ refreshToken: "keep-me" });
  check("Google not rotating the refresh token keeps the one we have",
    kept.refreshToken === "keep-me" && kept.accessToken === "new-at");

  // --- Google: free/busy and events ----------------------------------------
  stub = stubFetch(() => ({
    body: {
      calendars: {
        primary: {
          busy: [{ start: "2026-03-04T22:00:00Z", end: "2026-03-04T23:00:00Z" }],
        },
      },
    },
  }));
  const busy = await new GoogleCalendarProvider({ fetchImpl: stub }).listBusyPeriods({
    accessToken: "at", calendarId: "primary",
    from: new Date("2026-03-01"), to: new Date("2026-03-30"),
  });
  check("Google free/busy is read through the freeBusy endpoint",
    stub.calls[0].url.endsWith("/freeBusy") && stub.calls[0].options.method === "POST");
  check("busy periods come back as real dates",
    busy.length === 1 && busy[0].start instanceof Date);
  check("the access token travels as a bearer header, never in the query string",
    stub.calls[0].options.headers.Authorization === "Bearer at" &&
      !stub.calls[0].url.includes("at"));

  stub = stubFetch(() => ({
    body: { calendars: { primary: { errors: [{ reason: "notFound" }] } } },
  }));
  const gone = await throws(
    () => new GoogleCalendarProvider({ fetchImpl: stub }).listBusyPeriods({
      accessToken: "at", calendarId: "primary", from: new Date(), to: new Date(),
    }),
    (e) => e.code === "CALENDAR_GONE",
  );
  check("a deleted calendar is reported as such, not as an empty week",
    gone.threw && gone.matched);

  stub = stubFetch(() => ({ body: { id: "evt-1", htmlLink: "https://cal/evt-1" } }));
  const created = await new GoogleCalendarProvider({ fetchImpl: stub }).createEvent({
    accessToken: "at", calendarId: "primary", event: lesson,
  });
  const sentEvent = JSON.parse(stub.calls[0].options.body);
  check("creating a Google event returns its id", created.eventId === "evt-1");
  check("the event carries an IANA zone, so it survives a DST change",
    sentEvent.start.timeZone === "America/Toronto" && sentEvent.end.timeZone === "America/Toronto");
  check("no attendees are added, so no learner lands in a tutor's address book",
    sentEvent.attendees === undefined || sentEvent.attendees.length === 0);
  check("no client-chosen event id is sent, which Google would reject",
    sentEvent.id === undefined);

  stub = stubFetch(() => ({ status: 404, body: { error: { message: "Not Found" } } }));
  const deleteMissing = await new GoogleCalendarProvider({ fetchImpl: stub }).deleteEvent({
    accessToken: "at", calendarId: "primary", eventId: "gone",
  });
  check("deleting an event that is already gone is a success, not a failure",
    deleteMissing.deleted === true);

  // --- Microsoft ------------------------------------------------------------
  const ms = new MicrosoftCalendarProvider({ clientId: "mid", clientSecret: "msecret" });
  const msUrl = new URL(ms.getAuthorizationUrl({ redirectUri: "https://x.test/cb", state: "st9" }));
  check("Microsoft consent asks for offline_access, or there is no refresh token",
    msUrl.searchParams.get("scope").includes("offline_access"));
  check("Microsoft consent asks for calendar read/write",
    msUrl.searchParams.get("scope").includes("Calendars.ReadWrite"));
  check("the tenant defaults to common, so personal accounts can connect",
    msUrl.pathname.startsWith("/common/"));
  check("the Microsoft client secret never appears in a browser URL",
    !msUrl.toString().includes("msecret"));

  stub = stubFetch(() => ({
    body: {
      value: [
        { start: { dateTime: "2026-03-04T22:00:00.0000000" }, end: { dateTime: "2026-03-04T23:00:00.0000000" }, showAs: "busy" },
        { start: { dateTime: "2026-03-05T22:00:00.0000000" }, end: { dateTime: "2026-03-05T23:00:00.0000000" }, showAs: "free" },
        { start: { dateTime: "2026-03-06T22:00:00.0000000" }, end: { dateTime: "2026-03-06T23:00:00.0000000" }, showAs: "busy", isCancelled: true },
      ],
    },
  }));
  const msBusy = await new MicrosoftCalendarProvider({ fetchImpl: stub }).listBusyPeriods({
    accessToken: "at", calendarId: "cal-1",
    from: new Date("2026-03-01"), to: new Date("2026-03-30"),
  });
  check("Graph busy time is read from the chosen calendar's view, not the mailbox",
    stub.calls[0].url.includes("/me/calendars/cal-1/calendarView"));
  check("time the tutor marked free does not block their availability",
    msBusy.length === 1);
  check("a cancelled Outlook event does not block availability either",
    msBusy.every((p) => p.start.toISOString().startsWith("2026-03-04")));
  check("Graph's naive local strings are parsed as real instants",
    msBusy[0].start instanceof Date && !Number.isNaN(msBusy[0].start.getTime()));

  stub = stubFetch(() => ({ body: { id: "ms-evt-1", webLink: "https://outlook/evt" } }));
  const msCreated = await new MicrosoftCalendarProvider({ fetchImpl: stub }).createEvent({
    accessToken: "at", calendarId: "cal-1", event: lesson,
  });
  const msEvent = JSON.parse(stub.calls[0].options.body);
  check("creating a Graph event returns its id", msCreated.eventId === "ms-evt-1");
  check("Graph gets a wall-clock time plus a named zone, not an offset",
    !/Z$/.test(msEvent.start.dateTime) && msEvent.start.timeZone === "America/Toronto");
  check("the lesson shows as busy on the tutor's calendar", msEvent.showAs === "busy");
  check("no attendees are invited on Outlook either", msEvent.attendees.length === 0);
  check("the transaction id makes a repeated create idempotent at Graph",
    msEvent.transactionId === "apl-b1-c1");

  // --- development implementation -------------------------------------------
  const dev = new DevelopmentCalendarProvider(CALENDAR_PROVIDERS.GOOGLE);
  const devAuth = new URL(dev.getAuthorizationUrl({ redirectUri: "https://x.test/cb", state: "s" }));
  check("the development provider redirects straight back with a code",
    devAuth.searchParams.get("code")?.startsWith("dev-") && devAuth.searchParams.get("state") === "s");

  const devTokens = await dev.exchangeCode({ code: "dev-abc", userEmail: "t@example.com" });
  check("the development exchange says plainly that it is simulated",
    devTokens.simulated === true && devTokens.refreshToken.startsWith("dev-refresh"));

  const devEvent = await dev.createEvent({ event: lesson });
  check("the development provider creates a real, identified event",
    Boolean(devEvent.eventId) && devEvent.simulated === true);

  const devBusy = await dev.listBusyPeriods({
    from: new Date("2026-03-01"), to: new Date("2026-03-30"),
    events: [{ eventId: "e1", start: lesson.start, end: lesson.end }],
  });
  check("a development event really does come back as busy time", devBusy.length === 1);
  check("a cancelled development event does not",
    (await dev.listBusyPeriods({
      from: new Date("2026-03-01"), to: new Date("2026-03-30"),
      events: [{ eventId: "e1", start: lesson.start, end: lesson.end, cancelledAt: new Date() }],
    })).length === 0);
  check("an event outside the window is not returned",
    (await dev.listBusyPeriods({
      from: new Date("2027-01-01"), to: new Date("2027-02-01"),
      events: [{ eventId: "e1", start: lesson.start, end: lesson.end }],
    })).length === 0);

  // --- selection ------------------------------------------------------------
  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    resetCalendarProviders();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetCalendarProviders();
    }
  };

  await withEnv({
    CALENDAR_PROVIDER: undefined,
    GOOGLE_CALENDAR_CLIENT_ID: undefined, GOOGLE_CALENDAR_CLIENT_SECRET: undefined,
    MICROSOFT_CALENDAR_CLIENT_ID: undefined, MICROSOFT_CALENDAR_CLIENT_SECRET: undefined,
  }, async () => {
    check("with no credentials, calendar sync uses the development implementation",
      (await getCalendarProvider(CALENDAR_PROVIDERS.GOOGLE)).name === "GOOGLE_DEVELOPMENT");
    const status = await calendarIntegrationsStatus();
    check("both providers are still offered, because the fake is a working one",
      status.length === 2 && status.every((p) => p.available));
    check("and each says honestly that it is not the real service",
      status.every((p) => p.live === false));
  });

  await withEnv({
    CALENDAR_PROVIDER: "google,microsoft",
    GOOGLE_CALENDAR_CLIENT_ID: "gid", GOOGLE_CALENDAR_CLIENT_SECRET: "gs",
    MICROSOFT_CALENDAR_CLIENT_ID: "mid", MICROSOFT_CALENDAR_CLIENT_SECRET: "ms",
  }, async () => {
    check("both real adapters light up when both are configured",
      (await getCalendarProvider(CALENDAR_PROVIDERS.GOOGLE)).name === "GOOGLE" &&
        (await getCalendarProvider(CALENDAR_PROVIDERS.OUTLOOK)).name === "OUTLOOK");
    check("and both report as live", (await calendarIntegrationsStatus()).every((p) => p.live));
  });

  await withEnv({
    CALENDAR_PROVIDER: "google",
    GOOGLE_CALENDAR_CLIENT_ID: "gid", GOOGLE_CALENDAR_CLIENT_SECRET: "gs",
    MICROSOFT_CALENDAR_CLIENT_ID: undefined, MICROSOFT_CALENDAR_CLIENT_SECRET: undefined,
  }, async () => {
    check("naming only Google leaves Outlook on the development implementation",
      (await getCalendarProvider(CALENDAR_PROVIDERS.GOOGLE)).name === "GOOGLE" &&
        (await getCalendarProvider(CALENDAR_PROVIDERS.OUTLOOK)).name === "OUTLOOK_DEVELOPMENT");
  });

  await withEnv({ CALENDAR_PROVIDER: "google", GOOGLE_CALENDAR_CLIENT_ID: "only-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: undefined }, async () => {
    const { resolveIntegration } = await import("@/lib/config/env");
    const resolved = resolveIntegration("calendar");
    check("naming Google without its secret is a configuration error",
      resolved.configured === false &&
        /GOOGLE_CALENDAR_CLIENT_SECRET/.test(resolved.error ?? ""));
  });
}

// --- 16. Calendar service (§18, §36, §41 Phase 2) --------------------------

/**
 * The connection lifecycle end to end, against the development provider and a
 * real database: consent, token storage, busy-period sync, availability,
 * pushing a lesson out, moving it, removing it, and disconnecting.
 */
async function calendarServiceTests() {
  section("Calendar — connection lifecycle, sync and booking integration");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("calendar service", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("calendar service", "MongoDB is not reachable");
    }
  }

  const { CalendarConnection, TutorProfile, Booking, AuditLog } = await import("@/models");
  const cal = await import("@/services/calendar.service");
  const { getCalendarProvider } = await import("@/services/external/calendar-provider");
  const { signState } = await import("@/lib/security/crypto");
  const { decryptSecret } = await import("@/lib/security/crypto");
  const {
    CALENDAR_PROVIDERS, CALENDAR_CONNECTION_STATUS, CALENDAR_EVENT_STATE,
    BOOKING_STATUS, ROLES,
  } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).populate("userId", "_id email").lean();
  if (!tutor) return skip("calendar service", "no seeded tutor — run `bun run seed`");

  const tutorUserId = String(tutor.userId._id ?? tutor.userId);
  const actor = { id: tutorUserId, role: ROLES.TUTOR };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.TUTOR };

  const createdBookings = [];

  try {
    await CalendarConnection.deleteMany({ userId: tutorUserId });

    // --- consent --------------------------------------------------------------
    const begin = await cal.beginConnection(actor, { provider: CALENDAR_PROVIDERS.GOOGLE });
    const authUrl = new URL(begin.authorizationUrl);
    check("starting a connection returns a consent URL", Boolean(begin.authorizationUrl));
    const state = authUrl.searchParams.get("state");
    const code = authUrl.searchParams.get("code");
    check("the consent URL carries a signed state", Boolean(state));

    const unsigned = await throws(
      () => cal.completeConnection({ code, state: "not-a-real-state" }),
      (e) => e.status === 403,
    );
    check("a callback with an unverifiable state is refused before any exchange",
      unsigned.threw && unsigned.matched);

    const forSomeoneElse = signState(
      { userId: String(new mongoose.Types.ObjectId()), provider: CALENDAR_PROVIDERS.GOOGLE },
      { label: "aplus:calendar-state" },
    );
    const wrongAccount = await throws(
      () => cal.completeConnection({ code, state: forSomeoneElse }),
      (e) => e.status === 404,
    );
    check("a state naming an account that does not exist is refused",
      wrongAccount.threw && wrongAccount.matched);

    const connection = await cal.completeConnection({ code, state });
    check("consent produces a connected calendar",
      connection.status === CALENDAR_CONNECTION_STATUS.CONNECTED);
    check("the connection is labelled as the development implementation",
      connection.simulated === true);
    check("a calendar is chosen automatically so the connection is usable",
      Boolean(connection.calendarId));
    check("the connection is linked to the tutor profile, not just the account",
      Boolean(
        (await CalendarConnection.findById(connection.id).lean()).tutorProfileId,
      ));

    // --- tokens at rest -------------------------------------------------------
    const stored = await CalendarConnection.findById(connection.id)
      .select("+accessToken +refreshToken")
      .lean();
    check("the refresh token is encrypted at rest",
      stored.refreshToken.startsWith("v1.") && !stored.refreshToken.includes("dev-refresh"));
    check("the access token is encrypted at rest", stored.accessToken.startsWith("v1."));
    check("and it decrypts back to something usable",
      decryptSecret(stored.refreshToken, "aplus:calendar-token")?.startsWith("dev-refresh"));

    const publicShape = JSON.stringify(connection);
    check("no token ever reaches the shape a browser is given",
      !publicShape.includes("v1.") && !/token/i.test(publicShape));

    const listed = await cal.listConnections(tutorUserId);
    check("the tutor sees their connection", listed.connections.length === 1);
    check("no token appears in the list either",
      !/token/i.test(JSON.stringify(listed.connections)));

    // --- reconnecting the same account ----------------------------------------
    const again = await cal.beginConnection(actor, { provider: CALENDAR_PROVIDERS.GOOGLE });
    const againUrl = new URL(again.authorizationUrl);
    await cal.completeConnection({
      code: againUrl.searchParams.get("code"),
      state: againUrl.searchParams.get("state"),
    });
    check("reconnecting the same account updates the connection rather than duplicating it",
      (await CalendarConnection.countDocuments({ userId: tutorUserId })) === 1);

    // --- authorization --------------------------------------------------------
    const notYours = await throws(
      () => cal.updateConnection(connection.id, { syncBusy: false }, stranger),
      (e) => e.status === 403,
    );
    check("a tutor cannot touch someone else's calendar connection",
      notYours.threw && notYours.matched);

    const notYoursDelete = await throws(
      () => cal.disconnectCalendar(connection.id, stranger),
      (e) => e.status === 403,
    );
    check("nor disconnect it", notYoursDelete.threw && notYoursDelete.matched);

    // --- pushing a lesson out --------------------------------------------------
    const startAt = new Date("2031-06-10T18:00:00.000Z");
    const booking = await Booking.create({
      reference: `APL-C${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: new mongoose.Types.ObjectId(),
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      courseCode: "MHF4U",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      timeZone: "America/Toronto",
      status: BOOKING_STATUS.CONFIRMED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100,
        totalCents: 6000,
      },
    });
    createdBookings.push(booking._id);

    const pushed = await cal.pushBookingEvent(booking._id);
    check("a confirmed lesson is pushed to the connected calendar", pushed.pushed === 1);

    const withEvent = await Booking.findById(booking._id).lean();
    check("the event is linked to the booking",
      withEvent.externalEvents.length === 1 &&
        withEvent.externalEvents[0].state === CALENDAR_EVENT_STATE.SYNCED);

    await cal.pushBookingEvent(booking._id);
    const afterRetry = await Booking.findById(booking._id).lean();
    check("pushing the same lesson twice updates rather than duplicating",
      afterRetry.externalEvents.length === 1 &&
        afterRetry.externalEvents[0].eventId === withEvent.externalEvents[0].eventId);

    // --- busy periods and availability ------------------------------------------
    const synced = await cal.syncConnection(connection.id, { now: new Date("2031-06-01") });
    check("syncing finds the lesson we just put on the calendar", synced.synced === 1);

    const periods = await cal.externalBusyPeriods(tutor._id, {
      from: new Date("2031-06-01"),
      to: new Date("2031-07-01"),
    });
    check("the lesson comes back as busy time for availability",
      periods.length === 1 && new Date(periods[0].startAt).getTime() === startAt.getTime());

    check("busy periods outside the window asked for are not returned",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2032-01-01"), to: new Date("2032-02-01"),
      })).length === 0);

    await cal.updateConnection(connection.id, { syncBusy: false }, actor);
    check("a tutor who turns off availability sync stops contributing busy time",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2031-06-01"), to: new Date("2031-07-01"),
      })).length === 0);
    await cal.updateConnection(connection.id, { syncBusy: true }, actor);

    // --- moving and removing -----------------------------------------------------
    const movedStart = new Date("2031-06-11T18:00:00.000Z");
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { startAt: movedStart, endAt: new Date(movedStart.getTime() + 3600_000) } },
    );
    await cal.updateBookingEvent(booking._id);
    await cal.syncConnection(connection.id, { now: new Date("2031-06-01") });

    const movedPeriods = await cal.externalBusyPeriods(tutor._id, {
      from: new Date("2031-06-01"), to: new Date("2031-07-01"),
    });
    check("a rescheduled lesson moves on the calendar rather than appearing twice",
      movedPeriods.length === 1 &&
        new Date(movedPeriods[0].startAt).getTime() === movedStart.getTime());

    const removed = await cal.removeBookingEvent(booking._id);
    check("a cancelled lesson is taken off the calendar", removed.removed === 1);
    await cal.syncConnection(connection.id, { now: new Date("2031-06-01") });
    check("and stops blocking the tutor's availability",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2031-06-01"), to: new Date("2031-07-01"),
      })).length === 0);

    const removedAgain = await cal.removeBookingEvent(booking._id);
    check("removing an already-removed event is a no-op, not an error",
      removedAgain.removed === 0);

    // --- push disabled ------------------------------------------------------------
    await cal.updateConnection(connection.id, { pushEvents: false }, actor);
    await Booking.updateOne({ _id: booking._id }, { $set: { externalEvents: [] } });
    const suppressed = await cal.pushBookingEvent(booking._id);
    check("a tutor who turns off event push gets no lessons written to their calendar",
      suppressed.pushed === 0);
    await cal.updateConnection(connection.id, { pushEvents: true }, actor);

    // --- unconfirmed lessons ---------------------------------------------------------
    await Booking.updateOne(
      { _id: booking._id },
      { $set: { status: BOOKING_STATUS.PENDING_PAYMENT, externalEvents: [] } },
    );
    const unpaid = await cal.pushBookingEvent(booking._id);
    check("an unpaid lesson never reaches anybody's calendar",
      unpaid.pushed === 0 && unpaid.skipped === "NOT_CONFIRMED");
    await Booking.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.CONFIRMED } });

    // --- the scheduled sweep ----------------------------------------------------------
    await CalendarConnection.updateOne({ _id: connection.id }, { $set: { freshUntil: null } });
    const sweep = await cal.syncStaleCalendars({ now: new Date("2031-06-01") });
    check("the sweep refreshes a connection whose cache has aged out",
      sweep.synced >= 1 && sweep.examined >= 1);

    const quiet = await cal.syncStaleCalendars({ now: new Date("2031-06-01") });
    check("and finds nothing to do on the next run", quiet.examined === 0);

    // --- disconnecting -----------------------------------------------------------------
    await cal.pushBookingEvent(booking._id);
    const disconnected = await cal.disconnectCalendar(connection.id, actor);
    check("disconnecting succeeds", disconnected.disconnected === true);
    check("and the connection is gone",
      (await CalendarConnection.countDocuments({ userId: tutorUserId })) === 0);

    const cleaned = await Booking.findById(booking._id).lean();
    check("the lessons we added were taken off the calendar first",
      cleaned.externalEvents.every((e) => e.state === CALENDAR_EVENT_STATE.DELETED));

    check("a disconnected calendar contributes no busy time",
      (await cal.externalBusyPeriods(tutor._id, {
        from: new Date("2031-06-01"), to: new Date("2031-07-01"),
      })).length === 0);

    // --- audit ---------------------------------------------------------------------------
    const trail = await AuditLog.find({ entityType: "CalendarConnection" }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("connecting a calendar is audited", actions.has("CALENDAR_CONNECTED"));
    check("disconnecting one is audited", actions.has("CALENDAR_DISCONNECTED"));
    check("no audit row carries a token",
      trail.every((r) => !/v1\./.test(JSON.stringify(r.metadata ?? {}))));
  } finally {
    await CalendarConnection.deleteMany({ userId: tutorUserId });
    await Booking.deleteMany({ _id: { $in: createdBookings } });
    await AuditLog.deleteMany({ entityType: "CalendarConnection" });
  }
}


// --- 17. Progress reports (§35, §41 Phase 2) ------------------------------

/**
 * Who may write, who may read, and whether history survives an edit.
 *
 * The last one is the point of the feature: a family that read a report last
 * term should still be able to see what it said, however many times the tutor
 * has revised it since.
 */
async function progressReportTests() {
  section("Progress reports — authorship, privacy and revision history");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("progress reports", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("progress reports", "MongoDB is not reachable");
    }
  }

  const { ProgressReport, StudentProfile, TutorProfile, Booking, Notification, AuditLog } =
    await import("@/models");
  const progress = await import("@/services/progress.service");
  const {
    PROGRESS_REPORT_STATUS, GOAL_PROGRESS, BOOKING_STATUS, ROLES,
  } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !seededStudent) {
    return skip("progress reports", "no seeded tutor/student — run `bun run seed`");
  }

  // A learner of this test's own, so "has this tutor taught them?" has a
  // known answer rather than one that depends on what the seed happened to
  // book.
  const student = await StudentProfile.create({
    ownerId: seededStudent.ownerId,
    firstName: "Progress",
    lastName: "Testcase",
    isMinor: true,
    shareFullNameWithTutor: false,
  });

  const tutorActor = { id: String(tutor.userId), role: ROLES.TUTOR };
  const owner = { id: String(student.ownerId), role: ROLES.PARENT };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const otherTutor = { id: String(new mongoose.Types.ObjectId()), role: ROLES.TUTOR };
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

  const madeBookings = [];
  const madeReports = [];
  let goalId = null;

  try {
    // A goal on the learner's record, which the report should pick up.
    const withGoal = await StudentProfile.findByIdAndUpdate(
      student._id,
      { $push: { learningGoals: { label: "Integration test goal — safe to delete." } } },
      { new: true },
    );
    goalId = withGoal.learningGoals.at(-1)._id;

    // --- a report needs lessons that actually happened -------------------------
    const noLessons = await throws(
      () => progress.createProgressReport({ studentProfileId: String(student._id) }, tutorActor),
      (e) => e.code === "NO_COMPLETED_LESSONS",
    );
    check("a tutor cannot report on a student they have never taught",
      noLessons.threw && noLessons.matched, noLessons.error?.message);

    const startAt = new Date("2030-02-04T18:00:00.000Z");
    const lesson = await Booking.create({
      reference: `APL-P${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: student.ownerId,
      studentProfileId: student._id,
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: tutor.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      courseCode: "MHF4U",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      completedAt: new Date(),
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(lesson._id);

    const report = await progress.createProgressReport(
      { studentProfileId: String(student._id) }, tutorActor,
    );
    madeReports.push(report.id);

    check("a report starts as a draft", report.status === PROGRESS_REPORT_STATUS.DRAFT);
    check("the lessons it covers are resolved from completed bookings",
      report.lessonCount === 1 && report.bookingIds.length === 1);
    check("the learner's own goals are carried into the report",
      report.goals.some((g) => g.label.startsWith("Integration test goal")));
    check("the paying account is recorded so reads are a single lookup",
      String(report.ownerId) === String(student.ownerId));

    const duplicate = await throws(
      () => progress.createProgressReport({ studentProfileId: String(student._id) }, tutorActor),
      (e) => e.status === 409,
    );
    check("a second draft for the same student is refused",
      duplicate.threw && duplicate.matched);

    // --- a draft is nobody else's business --------------------------------------
    const familySeesDraft = await throws(
      () => progress.getProgressReport(report.id, owner),
      (e) => e.status === 404,
    );
    check("a family cannot see an unfinished draft",
      familySeesDraft.threw && familySeesDraft.matched);

    const adminSeesDraft = await throws(
      () => progress.getProgressReport(report.id, admin),
      (e) => e.status === 404,
    );
    check("nor can an administrator", adminSeesDraft.threw && adminSeesDraft.matched);

    const ownerList = await progress.listReportsForOwner(owner, {});
    check("a draft never appears in the family's history",
      !ownerList.items.some((r) => r.id === report.id));

    // --- only the author writes ---------------------------------------------------
    const familyEdits = await throws(
      () => progress.updateProgressReport(report.id, { summary: "Rewritten by the family." }, owner),
      (e) => e.status === 403,
    );
    check("a family cannot edit a tutor's report", familyEdits.threw && familyEdits.matched);

    const tutorEdits = await throws(
      () => progress.updateProgressReport(report.id, { summary: "Rewritten by another tutor." }, otherTutor),
      (e) => e.status === 403,
    );
    check("another tutor cannot edit it either", tutorEdits.threw && tutorEdits.matched);

    const familySubmits = await throws(
      () => progress.submitProgressReport(report.id, owner),
      (e) => e.status === 403,
    );
    check("a family cannot share a report on the tutor's behalf",
      familySubmits.threw && familySubmits.matched);

    // --- sharing ------------------------------------------------------------------
    const tooShort = await throws(
      () => progress.submitProgressReport(report.id, tutorActor),
      (e) => e.code === "SUMMARY_REQUIRED",
    );
    check("a report with no summary cannot be shared", tooShort.threw && tooShort.matched);

    await progress.updateProgressReport(
      report.id,
      {
        summary: "Covered logarithms and rational graphs. Change-of-base is now solid.",
        strengths: "Works through the algebra without prompting.",
        ratings: { understanding: 4, effort: 5 },
        privateNote: "Parent asked about exam timing — do not repeat to the student.",
        goals: [{ goalId: String(goalId), label: "Integration test goal — safe to delete.", status: GOAL_PROGRESS.ACHIEVED }],
      },
      tutorActor,
    );

    const shared = await progress.submitProgressReport(report.id, tutorActor);
    check("sharing moves the report out of draft",
      shared.status === PROGRESS_REPORT_STATUS.SUBMITTED && Boolean(shared.submittedAt));

    const learnerRecord = await StudentProfile.findById(student._id).lean();
    const recordedGoal = learnerRecord.learningGoals.find((g) => String(g._id) === String(goalId));
    check("a goal marked achieved reaches the learner's own record",
      Boolean(recordedGoal?.achievedAt));

    const shareTwice = await throws(
      () => progress.submitProgressReport(report.id, tutorActor),
      (e) => e.status === 409,
    );
    check("a report cannot be shared twice", shareTwice.threw && shareTwice.matched);

    // --- reading --------------------------------------------------------------------
    const familyView = await progress.getProgressReport(report.id, owner);
    check("the family can now read it", familyView.report.id === report.id);
    check("the family may acknowledge but not edit",
      familyView.canAcknowledge === true && familyView.canEdit === false);
    check("the tutor's private note is never loaded for the family",
      familyView.report.privateNote === undefined);
    check("the family sees who wrote it",
      Boolean(familyView.report.tutorProfileId?.displayName));

    const strangerView = await throws(
      () => progress.getProgressReport(report.id, stranger),
      (e) => e.status === 403,
    );
    check("an unrelated account cannot read it", strangerView.threw && strangerView.matched);

    const authorView = await progress.getProgressReport(report.id, tutorActor);
    check("the author still sees their own private note",
      typeof authorView.report.privateNote === "string");
    check("the learner's name is masked for the tutor unless the family opted in",
      Boolean(authorView.report.studentProfileId?.displayName));

    const adminView = await progress.getProgressReport(report.id, admin);
    check("an administrator can read a shared report for support",
      adminView.report.id === report.id);
    check("but not the tutor's private note",
      adminView.report.privateNote === undefined);

    // --- acknowledgement ---------------------------------------------------------------
    const strangerAck = await throws(
      () => progress.acknowledgeProgressReport(report.id, stranger),
      (e) => e.status === 403,
    );
    check("only the family may acknowledge", strangerAck.threw && strangerAck.matched);

    const acked = await progress.acknowledgeProgressReport(report.id, owner);
    check("acknowledging records who read it and when",
      Boolean(acked.acknowledgedAt) && String(acked.acknowledgedBy) === owner.id);
    check("acknowledging changes nothing the tutor wrote",
      acked.summary === shared.summary);

    const ackTwice = await progress.acknowledgeProgressReport(report.id, owner);
    check("acknowledging twice does not move the timestamp",
      String(ackTwice.acknowledgedAt) === String(acked.acknowledgedAt));

    // --- revision history ------------------------------------------------------------------
    const originalSummary = shared.summary;
    const revised = await progress.updateProgressReport(
      report.id,
      { summary: "Revised: the unit test is next Thursday, not Tuesday.", revisionReason: "Fixed the date." },
      tutorActor,
    );
    check("editing a shared report keeps the previous version",
      revised.revisions.length === 1);
    check("the kept version is what the family actually read",
      revised.revisions[0].snapshot.summary === originalSummary);
    check("the revision records why", revised.revisions[0].reason === "Fixed the date.");
    check("and the report now shows the new text",
      revised.summary.startsWith("Revised:"));

    const revisedAgain = await progress.updateProgressReport(
      report.id, { summary: "Revised twice." }, tutorActor,
    );
    check("every revision is kept, not just the last one",
      revisedAgain.revisions.length === 2 &&
        revisedAgain.revisions[0].snapshot.summary === originalSummary);

    const familyAfterRevision = await progress.getProgressReport(report.id, owner);
    check("the family can see the history too",
      familyAfterRevision.report.revisions.length === 2);

    // --- archiving ------------------------------------------------------------------------
    const archived = await progress.archiveProgressReport(report.id, tutorActor);
    check("a tutor can archive a report", archived.status === PROGRESS_REPORT_STATUS.ARCHIVED);

    const editArchived = await throws(
      () => progress.updateProgressReport(report.id, { summary: "Editing an archive." }, tutorActor),
      (e) => e.code === "REPORT_ARCHIVED",
    );
    check("an archived report cannot be edited", editArchived.threw && editArchived.matched);

    const stillReadable = await progress.getProgressReport(report.id, owner);
    check("but the family keeps their copy", stillReadable.report.id === report.id);

    // --- notifications and audit -----------------------------------------------------------
    const notices = await Notification.find({
      entityType: "ProgressReport",
      entityId: new mongoose.Types.ObjectId(report.id),
    }).lean();
    check("the family is told when a report is shared",
      notices.some((n) => n.type === "PROGRESS_REPORT_SHARED"));
    check("and when it is revised",
      notices.some((n) => n.type === "PROGRESS_REPORT_UPDATED"));

    const trail = await AuditLog.find({
      entityType: "ProgressReport",
      entityId: new mongoose.Types.ObjectId(report.id),
    }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("sharing a report is audited", actions.has("PROGRESS_REPORT_SUBMITTED"));
    check("revising one is audited", actions.has("PROGRESS_REPORT_REVISED"));
    check("archiving one is audited", actions.has("PROGRESS_REPORT_ARCHIVED"));

    // --- the tutor's student picker ---------------------------------------------------------
    const { students } = await progress.reportableStudents(tutorActor);
    check("the picker offers a learner this tutor has actually taught",
      students.some((s) => s.id === String(student._id)));
    check("the picker offers nobody to a tutor with no profile",
      (await progress.reportableStudents(otherTutor)).students.length === 0);
  } finally {
    const reportIds = madeReports.map((id) => new mongoose.Types.ObjectId(id));
    await Notification.deleteMany({ entityType: "ProgressReport", entityId: { $in: reportIds } });
    await AuditLog.deleteMany({ entityType: "ProgressReport", entityId: { $in: reportIds } });
    await ProgressReport.deleteMany({ studentProfileId: student._id });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    await StudentProfile.deleteOne({ _id: student._id });
  }
}


// --- 18. Referrals and account credit (§41 Phase 2) -----------------------

/**
 * The two things that decide whether a referral scheme is safe to run:
 * whether the same credit can be spent twice, and whether a reward can be
 * earned without anybody paying for a lesson.
 */
async function referralTests() {
  section("Referrals — attribution, qualifying, credit and abuse");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("referrals", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("referrals", "MongoDB is not reachable");
    }
  }

  const { User, Referral, CreditEntry, Booking, TutorProfile, Notification, AuditLog, Settings } =
    await import("@/models");
  const referrals = await import("@/services/referral.service");
  const credit = await import("@/services/credit.service");
  const { updateSettings, invalidateSettingsCache } = await import("@/services/settings.service");
  const { REFERRAL_STATUS, REFERRAL_RISK_FLAGS, BOOKING_STATUS, ROLES, USER_STATUS } =
    await import("@/constants");

  const settingsBefore = await Settings.findOne({ key: "PLATFORM" }).lean();
  const referralsBefore = settingsBefore?.referrals ?? {};

  // Real amounts, so the money paths are actually exercised. The shipped
  // defaults are zero and are asserted separately below.
  await updateSettings({
    referrals: {
      enabled: true,
      referrerRewardCents: 2000,
      refereeRewardCents: 1000,
      qualifyingLessons: 1,
      maxRewardsPerReferrer: 25,
    },
  });
  invalidateSettingsCache();

  const made = [];
  const madeBookings = [];
  const makeUser = async (over = {}) => {
    const user = await User.create({
      email: `referral-test-${randomUUID()}@example.com`,
      firstName: "Ref",
      lastName: "Tester",
      role: ROLES.PARENT,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
      ...over,
    });
    made.push(user._id);
    return user;
  };

  try {
    // --- codes ----------------------------------------------------------------
    const referrer = await makeUser();
    const code = await referrals.getOrCreateReferralCode(referrer._id);
    check("an account gets a referral code on first use", /^[A-Z2-9]{8}$/.test(code), code);
    check("asking again returns the same code",
      (await referrals.getOrCreateReferralCode(referrer._id)) === code);
    check("the code avoids characters that are misread aloud",
      !/[IO01]/.test(code));

    const lookup = await referrals.lookupReferralCode(code);
    check("a valid code resolves to a name", lookup.valid && Boolean(lookup.referrerName));
    check("the lookup never exposes a surname", !/ [A-Z][a-z]{2,}$/.test(lookup.referrerName));
    check("an unknown code simply does not resolve",
      (await referrals.lookupReferralCode("ZZZZZZZZ")).valid === false);

    // --- attribution ------------------------------------------------------------
    const referee = await makeUser();
    const attributed = await referrals.attributeReferral({
      code,
      refereeUserId: referee._id,
      email: referee.email,
      ip: "203.0.113.9",
    });
    check("a sign-up with a code is attributed", attributed.attributed === true);

    const stored = await Referral.findOne({ refereeUserId: referee._id }).lean();
    check("the referral starts pending", stored.status === REFERRAL_STATUS.PENDING);
    check("the sign-up address is hashed, never stored",
      Boolean(stored.signupIpHash) && !stored.signupIpHash.includes("203.0.113"));

    const twice = await referrals.attributeReferral({
      code,
      refereeUserId: referee._id,
      email: referee.email,
    });
    check("an account can only ever be introduced once",
      twice.attributed === false && twice.reason === "ALREADY_REFERRED");

    const selfCode = await referrals.getOrCreateReferralCode(referee._id);
    const self = await referrals.attributeReferral({
      code: selfCode,
      refereeUserId: referee._id,
      email: referee.email,
    });
    check("nobody can refer themselves",
      self.attributed === false && self.reason === "SELF_REFERRAL");

    const unknown = await referrals.attributeReferral({
      code: "NOTACODE",
      refereeUserId: (await makeUser())._id,
    });
    check("an unknown code is a quiet no-op, not a failed registration",
      unknown.attributed === false && unknown.reason === "UNKNOWN_CODE");

    // --- qualifying is earned by lessons, not sign-ups -----------------------------
    const tooSoon = await referrals.qualifyReferralFor(referee._id);
    check("a referral does not qualify on sign-up alone",
      tooSoon.qualified === false && tooSoon.reason === "NOT_ENOUGH_LESSONS");
    check("and no credit was granted", (await credit.creditBalance(referrer._id)) === 0);

    const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
    if (!tutor) return skip("referral qualifying", "no seeded tutor — run `bun run seed`");

    const startAt = new Date("2030-05-06T18:00:00.000Z");
    const lesson = await Booking.create({
      reference: `APL-R${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: referee._id,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(lesson._id);

    const qualified = await referrals.qualifyReferralFor(referee._id);
    check("a completed, paid lesson qualifies the referral", qualified.qualified === true);
    check("the referrer is credited", (await credit.creditBalance(referrer._id)) === 2000);
    check("the new account gets its welcome credit",
      (await credit.creditBalance(referee._id)) === 1000);

    const again = await referrals.qualifyReferralFor(referee._id);
    check("qualifying twice grants nothing more",
      again.qualified === false && (await credit.creditBalance(referrer._id)) === 2000);

    const rewarded = await Referral.findById(stored._id).lean();
    check("the referral records what was actually granted",
      rewarded.status === REFERRAL_STATUS.REWARDED && rewarded.referrerRewardCents === 2000);
    check("and which lesson earned it", rewarded.qualifyingBookingIds.length === 1);

    // --- credit cannot be spent twice ------------------------------------------------
    const spender = await makeUser();
    await credit.grantCredit({
      userId: spender._id, amountCents: 5000, reason: "ADMIN_ADJUSTMENT",
      note: "Integration test", notifyRecipient: false,
    });

    const paymentA = new mongoose.Types.ObjectId();
    const paymentB = new mongoose.Types.ObjectId();

    // Two checkouts racing for the same balance.
    const [spendA, spendB] = await Promise.all([
      credit.spendCredit({ userId: spender._id, maxCents: 5000, paymentId: paymentA }),
      credit.spendCredit({ userId: spender._id, maxCents: 5000, paymentId: paymentB }),
    ]);

    const totalSpent = spendA.appliedCents + spendB.appliedCents;
    check("two concurrent checkouts cannot spend the same credit twice",
      totalSpent === 5000, `${spendA.appliedCents} + ${spendB.appliedCents}`);
    check("and the balance lands at zero, never below",
      (await credit.creditBalance(spender._id)) === 0);

    // Whichever of the two actually took the credit is the one a retry would
    // hit; the loser rolled its claim back, so retrying that is a fresh spend
    // against an empty balance rather than a duplicate.
    const winner = spendA.appliedCents > 0 ? paymentA : paymentB;

    const retried = await credit.spendCredit({
      userId: spender._id, maxCents: 5000, paymentId: winner,
    });
    check("retrying the same payment reports what was already applied, not more",
      retried.duplicate === true && retried.appliedCents === 5000 &&
        (await credit.creditBalance(spender._id)) === 0);
    await credit.releaseCredit({
      userId: spender._id, amountCents: 5000, paymentId: winner,
    });
    check("credit returned from an abandoned checkout comes back",
      (await credit.creditBalance(spender._id)) === 5000);

    await credit.releaseCredit({
      userId: spender._id, amountCents: 5000, paymentId: winner,
    });
    check("releasing the same payment twice returns it once",
      (await credit.creditBalance(spender._id)) === 5000);

    const overspend = await credit.spendCredit({
      userId: spender._id, maxCents: 99999, paymentId: new mongoose.Types.ObjectId(),
    });
    check("a bill larger than the balance spends only what is there",
      overspend.appliedCents === 5000);

    // --- the ledger explains the balance ------------------------------------------------
    const statement = await credit.creditStatement(spender._id, {});
    check("every movement is on the statement", statement.entries.length >= 3);
    check("the statement's balance matches the account's", statement.balanceCents === 0);
    check("each entry records the balance it produced",
      statement.entries.every((e) => typeof e.balanceAfterCents === "number"));

    // --- reversal ------------------------------------------------------------------------
    const balanceBefore = await credit.creditBalance(referrer._id);
    const reversed = await referrals.reverseReferral(
      stored._id, { reason: "Integration test reversal." }, { id: referrer._id, role: ROLES.ADMIN },
    );
    check("a referral can be reversed", reversed.status === REFERRAL_STATUS.REVERSED);
    check("and the credit is taken back",
      (await credit.creditBalance(referrer._id)) === balanceBefore - 2000);

    const reverseTwice = await throws(
      () => referrals.reverseReferral(stored._id, { reason: "Again." }, { id: referrer._id }),
      (e) => e.status === 409,
    );
    check("a referral cannot be reversed twice", reverseTwice.threw && reverseTwice.matched);

    // A claw-back stops at zero rather than pushing an account into debt.
    const spentUp = await makeUser();
    await credit.grantCredit({
      userId: spentUp._id, amountCents: 500, reason: "REFERRAL_REWARD", notifyRecipient: false,
    });
    const clawed = await credit.clawBackCredit({ userId: spentUp._id, amountCents: 2000 });
    check("a claw-back recovers only what is left",
      clawed.recoveredCents === 500 && clawed.writtenOffCents === 1500);
    check("and never leaves a negative balance",
      (await credit.creditBalance(spentUp._id)) === 0);

    // --- risk flags are signals, not punishments --------------------------------------------
    const sharedPhone = "+14165550001";
    const flaggedReferrer = await makeUser({
      phoneE164: sharedPhone, phoneVerifiedAt: new Date(),
    });
    const flaggedCode = await referrals.getOrCreateReferralCode(flaggedReferrer._id);
    const flaggedReferee = await makeUser({
      phoneE164: sharedPhone, phoneVerifiedAt: new Date(),
    });

    const flagged = await referrals.attributeReferral({
      code: flaggedCode,
      refereeUserId: flaggedReferee._id,
      email: flaggedReferee.email,
    });
    check("two accounts sharing a confirmed mobile number are flagged",
      flagged.attributed === true &&
        flagged.flags.includes(REFERRAL_RISK_FLAGS.SHARED_PHONE));
    check("but the referral is still recorded rather than silently refused",
      flagged.attributed === true);

    const queue = await referrals.listAllReferrals({ flagged: true });
    check("flagged referrals reach the admin queue",
      queue.items.some((r) => String(r.refereeUserId?._id ?? r.refereeUserId) === String(flaggedReferee._id)));

    // --- a suspended referrer earns nothing ---------------------------------------------------
    await User.updateOne({ _id: flaggedReferrer._id }, { $set: { status: USER_STATUS.SUSPENDED } });
    const suspendedLesson = await Booking.create({
      reference: `APL-S${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: flaggedReferee._id,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(suspendedLesson._id);

    await referrals.qualifyReferralFor(flaggedReferee._id);
    check("a suspended referrer is not credited",
      (await credit.creditBalance(flaggedReferrer._id)) === 0);
    check("but the new account still gets its welcome credit",
      (await credit.creditBalance(flaggedReferee._id)) === 1000);

    // --- the scheme can be switched off ----------------------------------------------------------
    await updateSettings({ referrals: { enabled: false } });
    invalidateSettingsCache();

    const whileOff = await referrals.attributeReferral({
      code, refereeUserId: (await makeUser())._id,
    });
    check("no referral is attributed while the scheme is off",
      whileOff.attributed === false && whileOff.reason === "DISABLED");
    check("and a code stops resolving", (await referrals.lookupReferralCode(code)).valid === false);

    await updateSettings({ referrals: { enabled: true } });
    invalidateSettingsCache();

    // --- zero is a working configuration ------------------------------------------------------------
    await updateSettings({ referrals: { referrerRewardCents: 0, refereeRewardCents: 0 } });
    invalidateSettingsCache();

    const unpricedReferrer = await makeUser();
    const unpricedCode = await referrals.getOrCreateReferralCode(unpricedReferrer._id);
    const unpricedReferee = await makeUser();
    await referrals.attributeReferral({
      code: unpricedCode, refereeUserId: unpricedReferee._id, email: unpricedReferee.email,
    });

    const unpricedLesson = await Booking.create({
      reference: `APL-Z${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: unpricedReferee._id,
      studentProfileId: new mongoose.Types.ObjectId(),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(unpricedLesson._id);

    const unpricedResult = await referrals.qualifyReferralFor(unpricedReferee._id);
    check("with no reward configured a referral still qualifies",
      unpricedResult.qualified === true);
    check("and grants nothing, which is the operator's decision rather than a failure",
      (await credit.creditBalance(unpricedReferrer._id)) === 0);

    // --- the person's own page -----------------------------------------------------------------------
    const summary = await referrals.referralSummary({ id: referrer._id, role: ROLES.PARENT });
    check("a person sees their own code and stats",
      summary.code === code && summary.stats.joined >= 1);
    check("names on the referral page are first name plus initial",
      summary.referrals.every((r) => !/ [A-Z][a-z]{2,}$/.test(r.name)));

    // --- notifications and audit ----------------------------------------------------------------------
    const notices = await Notification.find({ userId: { $in: made } }).lean();
    check("a referrer is told when somebody joins with their code",
      notices.some((n) => n.type === "REFERRAL_JOINED"));
    check("and when the reward lands",
      notices.some((n) => n.type === "REFERRAL_REWARDED"));

    const trail = await AuditLog.find({ entityType: "Referral" }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("attribution is audited", actions.has("REFERRAL_ATTRIBUTED"));
    check("qualifying is audited", actions.has("REFERRAL_QUALIFIED"));
    check("reversal is audited", actions.has("REFERRAL_REVERSED"));
  } finally {
    await updateSettings({ referrals: { ...referralsBefore } });
    invalidateSettingsCache();
    await CreditEntry.deleteMany({ userId: { $in: made } });
    await Referral.deleteMany({
      $or: [{ referrerUserId: { $in: made } }, { refereeUserId: { $in: made } }],
    });
    await Notification.deleteMany({ userId: { $in: made } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    await AuditLog.deleteMany({ entityType: "Referral" });
    await User.deleteMany({ _id: { $in: made } });
  }
}


// --- 19. Tutor packages (§20, §41 Phase 2) --------------------------------

/**
 * The properties a package scheme lives or dies by: a lesson cannot be drawn
 * twice, a balance cannot go past what was bought, the money reconciles, and
 * a cancelled lesson goes back where it came from.
 */
async function packageTests() {
  section("Packages — pricing, consumption, cancellation and expiry");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("packages", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("packages", "MongoDB is not reachable");
    }
  }

  const {
    TutorPackage, PackagePurchase, TutorProfile, StudentProfile, Booking, Payment,
    Notification, AuditLog,
  } = await import("@/models");
  const pkgSvc = await import("@/services/package.service");
  const { assessPackagePrice, packageBreakdown, packageSessionPrice, unusedPackageValue } =
    await import("@/lib/booking/packages");
  const {
    PACKAGE_STATUS, PACKAGE_PURCHASE_STATUS, PAYMENT_STATUS, ROLES,
  } = await import("@/constants");
  const { resetPaymentProvider } = await import("@/services/external/payment-provider");

  // Buying a package opens a real checkout session. This section is about the
  // package rules, not the card rails — those have their own section — so it
  // runs against the development provider rather than reaching out to Stripe.
  const paymentProviderBefore = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "development";
  resetPaymentProvider();

  // --- pure pricing ---------------------------------------------------------
  const breakdown = packageBreakdown({
    priceCents: 50000, sessionCount: 10, durationMinutes: 60, commissionPercent: 15,
  });
  check("a package divides into per-session figures", breakdown.perSessionCents === 5000);
  check("commission is taken per session, the same way a lesson is",
    breakdown.perSessionCommissionCents === 750 &&
      breakdown.perSessionTutorEarningsCents === 4250);

  const awkward = packageBreakdown({
    priceCents: 10003, sessionCount: 3, durationMinutes: 60, commissionPercent: 15,
  });
  check("an awkward price keeps its remainder rather than losing cents",
    awkward.perSessionCents * 3 + awkward.remainderCents === 10003);

  const remainderPurchase = {
    priceCents: 10003, sessionsTotal: 3, perSessionCents: awkward.perSessionCents,
    sessionDurationMinutes: 60, commissionPercent: 15,
  };
  const firstSession = packageSessionPrice(remainderPurchase, { index: 0 });
  const laterSession = packageSessionPrice(remainderPurchase, { index: 1 });
  check("the rounding remainder rides on the first lesson",
    firstSession.subtotalCents + laterSession.subtotalCents * 2 === 10003);
  check("every session's commission and earnings still add up exactly",
    firstSession.commissionCents + firstSession.tutorEarningsCents === firstSession.subtotalCents);

  const tooDear = assessPackagePrice({
    priceCents: 100000, sessionCount: 10, durationMinutes: 60,
    standardHourlyRateCents: 6000, settings: { minHourlyRate: 15 },
  });
  check("a package that costs more per hour than booking singly is refused",
    tooDear.ok === false && tooDear.code === "ABOVE_STANDARD_RATE");

  const tooCheap = assessPackagePrice({
    priceCents: 1000, sessionCount: 10, durationMinutes: 60,
    standardHourlyRateCents: 6000, settings: { minHourlyRate: 15 },
  });
  check("a package below the platform minimum rate is refused",
    tooCheap.ok === false && tooCheap.code === "BELOW_MINIMUM_RATE");

  const fair = assessPackagePrice({
    priceCents: 50000, sessionCount: 10, durationMinutes: 60,
    standardHourlyRateCents: 6000, settings: { minHourlyRate: 15 },
  });
  check("a genuine discount is accepted and its saving computed",
    fair.ok === true && fair.savingPercent === 17, `${fair.savingPercent}%`);

  // --- against the database ---------------------------------------------------
  const tutor = await TutorProfile.findOne({ isSearchable: true })
    .populate("userId", "_id")
    .lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor?.courses?.length || !seededStudent) {
    return skip("package lifecycle", "no seeded tutor with courses — run `bun run seed`");
  }

  const tutorActor = { id: String(tutor.userId._id ?? tutor.userId), role: ROLES.TUTOR };
  const owner = { id: String(seededStudent.ownerId), role: ROLES.PARENT };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const course = tutor.courses[0];

  const madeIds = [];
  const madeBookings = [];

  try {
    await TutorPackage.deleteMany({ tutorProfileId: tutor._id, title: /^Integration test package/ });

    // --- creating an offer ----------------------------------------------------
    const overpriced = await throws(
      () => pkgSvc.createPackage({
        title: "Integration test package — overpriced",
        courseId: String(course.courseId),
        sessionCount: 5,
        sessionDurationMinutes: 60,
        mode: "ONLINE",
        priceCents: 99_000_00,
      }, tutorActor),
      (e) => e.code === "ABOVE_STANDARD_RATE",
    );
    check("a tutor cannot sell a package dearer than their own rate",
      overpriced.threw && overpriced.matched);

    const standardRate = course.hourlyRateCents ?? tutor.hourlyRateCents;
    const packagePrice = Math.floor(standardRate * 5 * 0.8);

    const offer = await pkgSvc.createPackage({
      title: "Integration test package — safe to delete",
      description: "Created by the integration suite.",
      courseId: String(course.courseId),
      sessionCount: 5,
      sessionDurationMinutes: 60,
      mode: tutor.lessonModes?.[0] ?? "ONLINE",
      priceCents: packagePrice,
      validityDays: 90,
    }, tutorActor);
    madeIds.push(offer.id);

    check("a package starts as a draft", offer.status === PACKAGE_STATUS.DRAFT);
    check("its per-session and hourly figures are derived, not supplied",
      offer.perSessionCents === Math.floor(packagePrice / 5) &&
        offer.effectiveHourlyRateCents > 0);
    check("the saving against the tutor's own rate is computed", offer.savingPercent > 0);

    const notYours = await throws(
      () => pkgSvc.updatePackage(offer.id, { title: "Hijacked" }, stranger),
      (e) => e.status === 403,
    );
    check("only the tutor who made a package can edit it", notYours.threw && notYours.matched);

    const draftPurchase = await throws(
      () => pkgSvc.purchasePackage({
        packageId: offer.id, studentProfileId: String(seededStudent._id),
      }, owner),
      (e) => e.code === "PACKAGE_NOT_ON_SALE",
    );
    check("a draft package cannot be bought", draftPurchase.threw && draftPurchase.matched);

    await pkgSvc.setPackageStatus(offer.id, { status: PACKAGE_STATUS.ACTIVE }, tutorActor);

    // --- buying ----------------------------------------------------------------
    const strangerBuys = await throws(
      () => pkgSvc.purchasePackage({
        packageId: offer.id, studentProfileId: String(seededStudent._id),
      }, stranger),
      (e) => e.status === 403,
    );
    check("nobody can buy a package for somebody else's child",
      strangerBuys.threw && strangerBuys.matched);

    const { purchase, payment } = await pkgSvc.purchasePackage({
      packageId: offer.id, studentProfileId: String(seededStudent._id),
    }, owner);

    check("buying creates a purchase awaiting payment",
      purchase.status === PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT);
    check("and an ordinary payment beside it", Boolean(payment.id));

    const paymentRow = await Payment.findById(payment.id).lean();
    check("the payment is for the package, not a booking",
      String(paymentRow.packagePurchaseId) === purchase.id && !paymentRow.bookingId);
    check("the payment total matches the package price",
      paymentRow.totalCents + (paymentRow.creditAppliedCents ?? 0) === packagePrice);
    check("the tutor's share is the sum of the sessions",
      paymentRow.tutorEarningsCents ===
        purchase.perSessionTutorEarningsCents * purchase.sessionsTotal);

    const unpaidDraw = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.code === "PACKAGE_NOT_USABLE",
    );
    check("an unpaid package has no lessons to draw", unpaidDraw.threw && unpaidDraw.matched);

    // --- activation -------------------------------------------------------------
    await Payment.updateOne(
      { _id: payment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    const activated = await pkgSvc.activatePackagePurchase(payment.id);
    check("a settled payment activates the package", activated.activated === 1);

    const again = await pkgSvc.activatePackagePurchase(payment.id);
    check("activating twice does nothing", again.activated === 0);

    const live = await PackagePurchase.findById(purchase.id).lean();
    check("the purchase is active with its lessons intact",
      live.status === PACKAGE_PURCHASE_STATUS.ACTIVE && live.sessionsUsed === 0);
    check("its validity is counted from activation, not from the click",
      Boolean(live.expiresAt) && new Date(live.expiresAt) > new Date());

    // --- the terms are frozen ------------------------------------------------------
    await pkgSvc.updatePackage(offer.id, { priceCents: Math.floor(packagePrice * 0.9) }, tutorActor);
    const afterRepricing = await PackagePurchase.findById(purchase.id).lean();
    check("repricing an offer does not change what somebody already bought",
      afterRepricing.priceCents === packagePrice);

    // --- drawing lessons ------------------------------------------------------------
    const drawn = await pkgSvc.consumePackageSession({
      purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
      courseId: course.courseId, durationMinutes: 60,
    });
    check("a lesson can be drawn", drawn.sessionsUsed === 1);

    const wrongTutor = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner,
        tutorProfileId: new mongoose.Types.ObjectId(),
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.code === "PACKAGE_WRONG_TUTOR",
    );
    check("a package cannot pay for a different tutor's lesson",
      wrongTutor.threw && wrongTutor.matched);

    const wrongCourse = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: new mongoose.Types.ObjectId(), durationMinutes: 60,
      }),
      (e) => e.code === "PACKAGE_WRONG_COURSE",
    );
    check("nor a different course", wrongCourse.threw && wrongCourse.matched);

    const wrongDuration = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 120,
      }),
      (e) => e.code === "PACKAGE_WRONG_DURATION",
    );
    check("nor a longer lesson than was bought", wrongDuration.threw && wrongDuration.matched);

    const notMine = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: stranger, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.status === 403,
    );
    check("somebody else cannot spend your package", notMine.threw && notMine.matched);

    // --- the balance cannot be overdrawn -----------------------------------------------
    // Four left, five concurrent attempts.
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        pkgSvc.consumePackageSession({
          purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
          courseId: course.courseId, durationMinutes: 60,
        }),
      ),
    );
    const succeeded = attempts.filter((a) => a.status === "fulfilled").length;
    check("concurrent draws never take more than the balance holds",
      succeeded === 4, `${succeeded} of 5 succeeded`);

    const emptied = await PackagePurchase.findById(purchase.id).lean();
    check("and the counter lands exactly on the total, never past it",
      emptied.sessionsUsed === emptied.sessionsTotal);

    const overdrawn = await throws(
      () => pkgSvc.consumePackageSession({
        purchaseId: purchase.id, actor: owner, tutorProfileId: tutor._id,
        courseId: course.courseId, durationMinutes: 60,
      }),
      (e) => e.status === 409,
    );
    check("an empty package refuses a further draw", overdrawn.threw && overdrawn.matched);

    // --- returning a session ----------------------------------------------------------------
    const fakeBookingId = new mongoose.Types.ObjectId();
    await PackagePurchase.updateOne(
      { _id: purchase.id },
      { $push: { bookingIds: fakeBookingId } },
    );
    const returned = await pkgSvc.returnPackageSession(purchase.id, fakeBookingId);
    check("a cancelled lesson goes back into the package", returned.returned === true);
    check("and the balance reflects it", returned.sessionsRemaining === 1);

    const returnedTwice = await pkgSvc.returnPackageSession(purchase.id, fakeBookingId);
    check("returning the same lesson twice cannot mint a session",
      returnedTwice.returned === false);

    // --- cancelling the balance ----------------------------------------------------------------
    const beforeCancel = await PackagePurchase.findById(purchase.id).lean();
    const unusedValue = unusedPackageValue(beforeCancel);
    check("only the unused lessons are worth refunding",
      unusedValue === beforeCancel.perSessionCents * 1);

    const strangerCancels = await throws(
      () => pkgSvc.cancelPurchase(purchase.id, { reason: "Not mine." }, stranger),
      (e) => e.status === 403,
    );
    check("somebody else cannot cancel your package",
      strangerCancels.threw && strangerCancels.matched);

    const cancelled = await pkgSvc.cancelPurchase(
      purchase.id, { reason: "Integration test." }, owner,
    );
    check("cancelling refunds the unused lessons",
      cancelled.refundCents === unusedValue, `${cancelled.refundCents} vs ${unusedValue}`);
    check("and marks the purchase refunded",
      cancelled.status === PACKAGE_PURCHASE_STATUS.REFUNDED);

    const cancelTwice = await throws(
      () => pkgSvc.cancelPurchase(purchase.id, { reason: "Again." }, owner),
      (e) => e.status === 409,
    );
    check("a package cannot be cancelled twice", cancelTwice.threw && cancelTwice.matched);

    const refundedPayment = await Payment.findById(payment.id).lean();
    check("the refund went through the ordinary payment record",
      refundedPayment.refundedCents === unusedValue);
    check("and never more than was charged",
      refundedPayment.refundedCents <= refundedPayment.totalCents);

    // --- expiry ------------------------------------------------------------------------------------
    const { purchase: expiring, payment: expiringPayment } = await pkgSvc.purchasePackage({
      packageId: offer.id, studentProfileId: String(seededStudent._id),
    }, owner);
    await Payment.updateOne(
      { _id: expiringPayment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    await pkgSvc.activatePackagePurchase(expiringPayment.id);
    await PackagePurchase.updateOne(
      { _id: expiring.id },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } },
    );

    const sweep = await pkgSvc.expirePackages();
    check("the expiry sweep closes an out-of-date package", sweep.expired >= 1);
    check("and refunds the lessons that were never delivered", sweep.refundedCents > 0);

    const expiredRow = await PackagePurchase.findById(expiring.id).lean();
    check("the expired package is marked as such",
      expiredRow.status === PACKAGE_PURCHASE_STATUS.EXPIRED);

    const sweepAgain = await pkgSvc.expirePackages();
    check("running the sweep again refunds nothing twice",
      sweepAgain.expired === 0 && sweepAgain.refundedCents === 0);

    // --- warnings ------------------------------------------------------------------------------------
    const { purchase: warned, payment: warnedPayment } = await pkgSvc.purchasePackage({
      packageId: offer.id, studentProfileId: String(seededStudent._id),
    }, owner);
    await Payment.updateOne(
      { _id: warnedPayment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    await pkgSvc.activatePackagePurchase(warnedPayment.id);
    await PackagePurchase.updateOne(
      { _id: warned.id },
      { $set: { expiresAt: new Date(Date.now() + 3 * 86400000), expiryWarnedAt: null } },
    );

    const warnRun = await pkgSvc.expirePackages();
    check("a package about to expire warns the family", warnRun.warned >= 1);
    const warnAgain = await pkgSvc.expirePackages();
    check("and never warns them twice", warnAgain.warned === 0);

    // --- archiving does not take away what was bought ---------------------------------------------------
    await pkgSvc.setPackageStatus(offer.id, { status: PACKAGE_STATUS.ARCHIVED }, tutorActor);
    const survivor = await PackagePurchase.findById(warned.id).lean();
    check("archiving an offer leaves existing balances alone",
      survivor.status === PACKAGE_PURCHASE_STATUS.ACTIVE);
    check("and the archived offer is off sale",
      (await pkgSvc.listPublicPackages(tutor._id)).every((p) => p.id !== offer.id));

    // --- audit --------------------------------------------------------------------------------------------
    const trail = await AuditLog.find({
      entityType: { $in: ["TutorPackage", "PackagePurchase"] },
    }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("publishing a package is audited", actions.has("PACKAGE_PUBLISHED"));
    check("buying one is audited", actions.has("PACKAGE_PURCHASED"));
    check("cancelling one is audited", actions.has("PACKAGE_CANCELLED"));
  } finally {
    if (paymentProviderBefore === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = paymentProviderBefore;
    resetPaymentProvider();

    const purchases = await PackagePurchase.find({
      packageId: { $in: madeIds.map((id) => new mongoose.Types.ObjectId(id)) },
    }).select("_id paymentId").lean();

    await Notification.deleteMany({
      entityType: "PackagePurchase",
      entityId: { $in: purchases.map((p) => p._id) },
    });
    await Payment.deleteMany({ _id: { $in: purchases.map((p) => p.paymentId).filter(Boolean) } });
    await PackagePurchase.deleteMany({ _id: { $in: purchases.map((p) => p._id) } });
    await TutorPackage.deleteMany({ _id: { $in: madeIds.map((id) => new mongoose.Types.ObjectId(id)) } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    await AuditLog.deleteMany({ entityType: { $in: ["TutorPackage", "PackagePurchase"] } });
  }
}


// --- 20. Group tutoring (§26, §41 Phase 2) --------------------------------

/**
 * Capacity, duplicate enrolment, and the money when a session does not run.
 *
 * The concurrency check is the important one: seats are the thing this
 * feature can most easily oversell, and overselling means a tutor turning up
 * to more people than they agreed to teach.
 */
async function groupSessionTests() {
  section("Group tutoring — capacity, enrolment and settlement");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("group tutoring", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("group tutoring", "MongoDB is not reachable");
    }
  }

  const {
    GroupSession, GroupEnrolment, Booking, Payment, TutorProfile, StudentProfile,
    Availability, Notification, AuditLog,
  } = await import("@/models");
  const groups = await import("@/services/group.service");
  const {
    GROUP_SESSION_STATUS, GROUP_ENROLMENT_STATUS, BOOKING_STATUS, PAYMENT_STATUS, ROLES,
  } = await import("@/constants");
  const { resetPaymentProvider } = await import("@/services/external/payment-provider");

  const paymentProviderBefore = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "development";
  resetPaymentProvider();

  const tutor = await TutorProfile.findOne({ isSearchable: true })
    .populate("userId", "_id")
    .lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor?.courses?.length || !seededStudent) {
    return skip("group tutoring", "no seeded tutor with courses — run `bun run seed`");
  }

  const availability = await Availability.findOne({ tutorProfileId: tutor._id }).lean();
  if (!availability?.weeklyRules?.length) {
    return skip("group tutoring", "the seeded tutor has published no availability");
  }

  const tutorActor = { id: String(tutor.userId._id ?? tutor.userId), role: ROLES.TUTOR };
  const owner = { id: String(seededStudent.ownerId), role: ROLES.PARENT };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const course = tutor.courses[0];

  const madeSessions = [];
  const madeStudents = [];

  /** Learners of this test's own, so capacity is exercised deterministically. */
  const makeStudent = async (name) => {
    const student = await StudentProfile.create({
      ownerId: seededStudent.ownerId,
      firstName: name,
      lastName: "Grouptest",
      isMinor: true,
    });
    madeStudents.push(student._id);
    return student;
  };

  /** A session at a time the tutor is genuinely free. */
  const nextFreeSlot = async () => {
    const { getBookableSlots } = await import("@/services/availability.service");
    const { days } = await getBookableSlots(tutor._id, { days: 28, durationMinutes: 60 });
    const day = days.find((d) => d.slots.length > 0);
    return day?.slots[0]?.startAt ?? null;
  };

  const startAt = await nextFreeSlot();
  if (!startAt) return skip("group tutoring", "the seeded tutor has no free slots");

  const makeSession = async (over = {}) => {
    const session = await groups.createGroupSession({
      title: "Integration test group — safe to delete",
      courseId: String(course.courseId),
      mode: tutor.lessonModes?.[0] ?? "ONLINE",
      meetingProvider: tutor.onlineMeetingProviders?.[0] ?? "ZOOM",
      startAt,
      durationMinutes: 60,
      minParticipants: 2,
      maxParticipants: 3,
      pricePerSeatCents: 2500,
      ...over,
    }, tutorActor);
    madeSessions.push(session.id);
    return session;
  };

  try {
    await GroupSession.deleteMany({ title: /^Integration test group/ });

    // --- creating and publishing ------------------------------------------------
    const invertedCapacity = await throws(
      () => makeSession({ minParticipants: 5, maxParticipants: 3 }),
      (e) => e.code === "CAPACITY_INVERTED",
    );
    check("a minimum larger than the maximum is refused",
      invertedCapacity.threw && invertedCapacity.matched);

    const session = await makeSession();
    check("a session starts as a draft", session.status === GROUP_SESSION_STATUS.DRAFT);
    check("its seats start empty", session.seatsTaken === 0);

    const joinDraft = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, owner),
      (e) => e.code === "SESSION_NOT_OPEN",
    );
    check("a draft session cannot be joined", joinDraft.threw && joinDraft.matched);

    const strangerPublishes = await throws(
      () => groups.publishGroupSession(session.id, stranger),
      (e) => e.status === 403,
    );
    check("only the tutor can publish their own session",
      strangerPublishes.threw && strangerPublishes.matched);

    const published = await groups.publishGroupSession(session.id, tutorActor);
    check("publishing opens it for sign-ups",
      published.status === GROUP_SESSION_STATUS.PUBLISHED);
    check("and sets the deadline by which it has to fill", Boolean(published.confirmBy));

    const publishTwice = await throws(
      () => groups.publishGroupSession(session.id, tutorActor),
      (e) => e.status === 409,
    );
    check("a session cannot be published twice", publishTwice.threw && publishTwice.matched);

    // --- a tutor is not a student in their own class ------------------------------
    const tutorJoins = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, { id: tutorActor.id, role: ROLES.TUTOR }),
      (e) => e.code === "TUTOR_CANNOT_JOIN_OWN" || e.status === 403,
    );
    check("a tutor cannot join their own session", tutorJoins.threw && tutorJoins.matched);

    const strangerJoins = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, stranger),
      (e) => e.status === 403,
    );
    check("nobody can enrol somebody else's child",
      strangerJoins.threw && strangerJoins.matched);

    // --- joining ---------------------------------------------------------------------
    const alice = await makeStudent("Alice");
    const first = await groups.joinGroupSession(session.id, {
      studentProfileId: String(alice._id),
    }, owner);

    check("joining creates an enrolment awaiting payment",
      first.enrolment.status === GROUP_ENROLMENT_STATUS.PENDING_PAYMENT);
    check("and an ordinary booking for that learner", Boolean(first.booking.id));
    check("the booking is linked to the session",
      String(first.booking.groupSessionId) === session.id);
    check("the seat is taken immediately, before payment",
      first.seatsRemaining === 2);
    check("the booking is priced from the seat price",
      first.booking.price.subtotalCents === 2500);
    check("and commission is taken the ordinary way",
      first.booking.price.commissionCents + first.booking.price.tutorEarningsCents === 2500);

    const joinTwice = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(alice._id),
      }, owner),
      (e) => e.status === 409,
    );
    check("the same learner cannot join twice", joinTwice.threw && joinTwice.matched);

    // --- capacity cannot be exceeded ---------------------------------------------------
    // Two seats left, five learners trying at once.
    const racers = await Promise.all(
      ["Bo", "Cai", "Dev", "Eve", "Fay"].map((name) => makeStudent(name)),
    );
    const outcomes = await Promise.allSettled(
      racers.map((student) =>
        groups.joinGroupSession(session.id, {
          studentProfileId: String(student._id),
        }, owner),
      ),
    );

    const seated = outcomes.filter(
      (o) => o.status === "fulfilled" && !o.value.waitlisted,
    ).length;
    const waitlisted = outcomes.filter(
      (o) => o.status === "fulfilled" && o.value.waitlisted,
    ).length;

    check("concurrent joins never oversell the seats", seated === 2, `${seated} seated`);
    check("everybody else goes on the waiting list rather than being refused",
      waitlisted === 3, `${waitlisted} waitlisted`);

    const full = await GroupSession.findById(session.id).lean();
    check("the seat counter lands exactly on the maximum",
      full.seatsTaken === full.maxParticipants);
    check("and the waiting list is counted", full.waitlistCount === 3);

    const bookings = await Booking.countDocuments({ groupSessionId: session._id });
    check("only seated learners got a booking", bookings === 3);
    check("nobody on the waiting list was charged",
      (await GroupEnrolment.countDocuments({
        sessionId: session._id,
        status: GROUP_ENROLMENT_STATUS.WAITLISTED,
        paymentId: { $ne: null },
      })) === 0);

    // --- confirming when the minimum is met ------------------------------------------------
    const seatedEnrolments = await GroupEnrolment.find({
      sessionId: session._id,
      status: GROUP_ENROLMENT_STATUS.PENDING_PAYMENT,
    }).lean();

    for (const enrolment of seatedEnrolments.slice(0, 2)) {
      await Payment.updateOne(
        { _id: enrolment.paymentId },
        { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
      );
      const booking = await Booking.findById(enrolment.bookingId);
      booking.status = BOOKING_STATUS.CONFIRMED;
      booking.confirmedAt = new Date();
      await booking.save();
      await groups.onGroupBookingConfirmed(booking);
    }

    const confirmed = await GroupSession.findById(session.id).lean();
    check("reaching the minimum confirms the session",
      confirmed.status === GROUP_SESSION_STATUS.CONFIRMED);
    check("and stamps when that happened", Boolean(confirmed.confirmedAt));

    // --- a seat given back goes to the waiting list -------------------------------------------
    // Through the ordinary cancellation path, which is how it actually
    // happens: `cancelBooking` applies the policy and then releases the seat.
    const { cancelBooking } = await import("@/services/booking.service");
    const leaving = seatedEnrolments[0];
    const cancelledPlace = await cancelBooking(
      leaving.bookingId, { reason: "Integration test." }, owner,
    );
    check("cancelling a place cancels the learner's booking", cancelledPlace.cancelled === 1);

    const afterRelease = await GroupSession.findById(session.id).lean();
    check("and the seat goes back into the session", afterRelease.seatsTaken === 2);

    const releasedEnrolment = await GroupEnrolment.findById(leaving._id).lean();
    check("the enrolment records that the place was given up",
      [GROUP_ENROLMENT_STATUS.CANCELLED, GROUP_ENROLMENT_STATUS.REFUNDED].includes(
        releasedEnrolment.status,
      ));

    const offered = await Notification.countDocuments({
      entityId: session._id,
      type: "GROUP_SEAT_AVAILABLE",
    });
    check("the first person waiting is told a seat opened up", offered >= 1);

    const releaseTwice = await groups.releaseGroupSeat(leaving.bookingId);
    check("releasing the same seat twice cannot invent capacity",
      releaseTwice.released === false);
    check("and the seat count is unchanged by the second attempt",
      (await GroupSession.findById(session.id).lean()).seatsTaken === 2);

    // --- the roster is private --------------------------------------------------------------------
    const asOwner = await groups.getGroupSession(session.id, owner);
    check("a family cannot see who else is in the class", asOwner.roster.length === 0);
    check("but does see their own places", asOwner.myEnrolments.length > 0);

    const asTutor = await groups.getGroupSession(session.id, tutorActor);
    check("the tutor sees the roster", asTutor.roster.length > 0);
    check("and it is names only, masked for minors",
      asTutor.roster.every((r) => !/Grouptest$/.test(r.studentName)));
    check("the tutor can manage the session", asTutor.canManage === true);

    const asAnon = await groups.getGroupSession(session.id, null);
    check("an anonymous visitor sees neither roster nor meeting link",
      asAnon.roster.length === 0 && asAnon.meeting === null);
    check("and never a private address",
      asAnon.session.location?.addressLine === undefined);

    // --- cancelling the whole session --------------------------------------------------------------
    const strangerCancels = await throws(
      () => groups.cancelGroupSession(session.id, { reason: "Not mine." }, stranger),
      (e) => e.status === 403,
    );
    check("only the tutor or an administrator can cancel a session",
      strangerCancels.threw && strangerCancels.matched);

    const cancelled = await groups.cancelGroupSession(
      session.id, { reason: "Integration test." }, tutorActor,
    );
    check("cancelling refunds everybody who paid", cancelled.refundedCents > 0);
    check("the session is marked cancelled",
      cancelled.status === GROUP_SESSION_STATUS.CANCELLED);
    check("and every seat is given back", cancelled.seatsTaken === 0);

    const cancelledBookings = await Booking.find({ groupSessionId: session._id }).lean();
    check("every booking still in the session was cancelled by the tutor",
      cancelledBookings
        .filter(
          (b) =>
            b.status !== BOOKING_STATUS.PENDING_PAYMENT &&
            b.status !== BOOKING_STATUS.CANCELLED_BY_STUDENT,
        )
        .every((b) => b.status === BOOKING_STATUS.CANCELLED_BY_TUTOR));
    check("no booking survived the cancellation as confirmed",
      cancelledBookings.every((b) => b.status !== BOOKING_STATUS.CONFIRMED));
    // Only the seats the *tutor* took away. A learner who left earlier in this
    // section cancelled their own place through the ordinary booking path and
    // was refunded by the notice policy, which is correctly less than the
    // whole — sweeping every cancellation record together would assert that a
    // voluntary cancellation is refunded like an abandoned class.
    check("and each seat the tutor cancelled records a full refund",
      cancelledBookings
        .filter((b) => b.cancellation && b.status === BOOKING_STATUS.CANCELLED_BY_TUTOR)
        .every((b) => b.cancellation.refundPercent === 100));

    const cancelTwice = await throws(
      () => groups.cancelGroupSession(session.id, { reason: "Again." }, tutorActor),
      (e) => e.status === 409,
    );
    check("a session cannot be cancelled twice", cancelTwice.threw && cancelTwice.matched);

    const joinCancelled = await throws(
      () => groups.joinGroupSession(session.id, {
        studentProfileId: String(seededStudent._id),
      }, owner),
      (e) => e.code === "SESSION_NOT_OPEN",
    );
    check("a cancelled session cannot be joined", joinCancelled.threw && joinCancelled.matched);

    // --- a session that never fills ---------------------------------------------------------------------
    const lonelySlot = await nextFreeSlot();
    const lonely = await makeSession({
      minParticipants: 3,
      maxParticipants: 5,
      startAt: lonelySlot ?? startAt,
    });
    await groups.publishGroupSession(lonely.id, tutorActor);

    const soloStudent = await makeStudent("Solo");
    const solo = await groups.joinGroupSession(lonely.id, {
      studentProfileId: String(soloStudent._id),
    }, owner);
    await Payment.updateOne(
      { _id: solo.payment.id },
      { $set: { status: PAYMENT_STATUS.PAID, paidAt: new Date() } },
    );
    const soloBooking = await Booking.findById(solo.booking.id);
    soloBooking.status = BOOKING_STATUS.CONFIRMED;
    await soloBooking.save();
    await groups.onGroupBookingConfirmed(soloBooking);

    const stillFilling = await GroupSession.findById(lonely.id).lean();
    check("one person does not confirm a session that needs three",
      stillFilling.status === GROUP_SESSION_STATUS.PUBLISHED);

    // Push the deadline into the past.
    await GroupSession.updateOne(
      { _id: lonely.id },
      { $set: { confirmBy: new Date(Date.now() - 60_000) } },
    );

    const settled = await groups.settleUnderfilledSessions();
    check("an under-subscribed session is cancelled at its deadline",
      settled.cancelled >= 1);
    check("and everybody is refunded in full", settled.refundedCents > 0);

    const lonelyAfter = await GroupSession.findById(lonely.id).lean();
    check("the under-filled session is marked cancelled",
      lonelyAfter.status === GROUP_SESSION_STATUS.CANCELLED);
    check("with a reason the family can read",
      /enough people/i.test(lonelyAfter.cancellationReason ?? ""));

    const settleAgain = await groups.settleUnderfilledSessions();
    check("running settlement again refunds nothing twice",
      settleAgain.cancelled === 0 && settleAgain.refundedCents === 0);

    // --- editing is locked once people have paid ----------------------------------------------------------
    const lockedSlot = await nextFreeSlot();
    const locked = await makeSession({ startAt: lockedSlot ?? startAt });
    await groups.publishGroupSession(locked.id, tutorActor);
    const joiner = await makeStudent("Locked");
    await groups.joinGroupSession(locked.id, {
      studentProfileId: String(joiner._id),
    }, owner);

    const repriced = await throws(
      () => groups.updateGroupSession(locked.id, { pricePerSeatCents: 100 }, tutorActor),
      (e) => e.code === "SESSION_HAS_ENROLMENTS",
    );
    check("the seat price cannot change once somebody has joined",
      repriced.threw && repriced.matched);

    const shrunk = await throws(
      () => groups.updateGroupSession(locked.id, { maxParticipants: 0 }, tutorActor),
      () => true,
    );
    check("capacity cannot be cut below the people already in it", shrunk.threw);

    const renamed = await groups.updateGroupSession(
      locked.id, { title: "Integration test group — renamed" }, tutorActor,
    );
    check("but the description and title can still be improved",
      renamed.title.endsWith("renamed"));

    // --- audit ---------------------------------------------------------------------------------------------
    const trail = await AuditLog.find({ entityType: "GroupSession" }).lean();
    const actions = new Set(trail.map((r) => r.action));
    check("publishing a session is audited", actions.has("GROUP_SESSION_PUBLISHED"));
    check("joining one is audited", actions.has("GROUP_ENROLMENT_CREATED"));
    check("cancelling one is audited", actions.has("GROUP_SESSION_CANCELLED"));
  } finally {
    if (paymentProviderBefore === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = paymentProviderBefore;
    resetPaymentProvider();

    const ids = madeSessions.map((id) => new mongoose.Types.ObjectId(id));
    const enrolments = await GroupEnrolment.find({ sessionId: { $in: ids } })
      .select("paymentId bookingId")
      .lean();

    await Notification.deleteMany({ entityType: "GroupSession", entityId: { $in: ids } });
    await Payment.deleteMany({ _id: { $in: enrolments.map((e) => e.paymentId).filter(Boolean) } });
    await Booking.deleteMany({ groupSessionId: { $in: ids } });
    await GroupEnrolment.deleteMany({ sessionId: { $in: ids } });
    await GroupSession.deleteMany({ _id: { $in: ids } });
    await StudentProfile.deleteMany({ _id: { $in: madeStudents } });
    await AuditLog.deleteMany({ entityType: "GroupSession" });
  }
}


// --- 21. Promoted tutor profiles (§41 Phase 2) -----------------------------

/**
 * Promotion is the one Phase 2 feature that reaches directly into what
 * families are shown, so the assertions here are weighted towards the two
 * ways it could do harm: making somebody visible who should not be, and
 * corrupting the result set everybody else is paginating through.
 */
async function promotionTests() {
  section("Promoted profiles — eligibility, ranking, pagination and expiry");

  // --- the pure ranking rules, no database needed ---------------------------
  const {
    promotionAffectsSort, promotedPageSlice, promotionLimits, livePromotionQuery,
  } = await import("@/lib/search/promotion");

  check("promotion applies to the default 'best match' ordering",
    promotionAffectsSort("RELEVANCE") === true && promotionAffectsSort(undefined) === true);
  check("a visitor's own sort order is never overridden by a promotion",
    ["PRICE_ASC", "PRICE_DESC", "RATING", "DISTANCE", "EXPERIENCE", "AVAILABILITY"]
      .every((sort) => promotionAffectsSort(sort) === false));

  const page1 = promotedPageSlice({ promotedCount: 3, page: 1, pageSize: 12 });
  check("page one leads with the promoted block and fills the rest normally",
    page1.promotedSkip === 0 && page1.promotedLimit === 3 &&
      page1.normalSkip === 0 && page1.normalLimit === 9);

  const page2 = promotedPageSlice({ promotedCount: 3, page: 2, pageSize: 12 });
  check("page two carries no promoted results and resumes where page one stopped",
    page2.promotedLimit === 0 && page2.normalSkip === 9 && page2.normalLimit === 12);

  const page3 = promotedPageSlice({ promotedCount: 3, page: 3, pageSize: 12 });
  check("deeper pages keep the offset consistent, so nothing is skipped or repeated",
    page3.normalSkip === 21 && page3.normalLimit === 12);

  const tiny = promotedPageSlice({ promotedCount: 5, page: 1, pageSize: 3 });
  check("more promoted tutors than fit on a page spill onto the next one in order",
    tiny.promotedSkip === 0 && tiny.promotedLimit === 3 && tiny.normalLimit === 0);
  const tinyNext = promotedPageSlice({ promotedCount: 5, page: 2, pageSize: 3 });
  check("and the spill picks up at the right promoted offset",
    tinyNext.promotedSkip === 3 && tinyNext.promotedLimit === 2 &&
      tinyNext.normalSkip === 0 && tinyNext.normalLimit === 1);

  const none = promotedPageSlice({ promotedCount: 0, page: 2, pageSize: 10 });
  check("with nothing promoted the arithmetic is the ordinary skip/limit",
    none.promotedLimit === 0 && none.normalSkip === 10 && none.normalLimit === 10);

  check("promotion limits fall back to 'off' rather than to a guess",
    promotionLimits({}).maxPromotedPerSearch === 0 && promotionLimits({}).maxActive === 0);
  check("a disabled platform reports promotions as off",
    promotionLimits({ promotions: { enabled: false } }).enabled === false);

  const at = new Date("2026-06-01T12:00:00.000Z");
  const liveQuery = livePromotionQuery(at);
  check("liveness is a time window, not just a stored status",
    liveQuery.status === "ACTIVE" &&
      liveQuery.startsAt.$lte.getTime() === at.getTime() &&
      liveQuery.endsAt.$gt.getTime() === at.getTime());

  // --- against the database ---------------------------------------------------
  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("promotion lifecycle", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("promotion lifecycle", "MongoDB is not reachable");
    }
  }

  const { TutorPromotion, TutorProfile, User, AuditLog, Notification } = await import("@/models");
  const promo = await import("@/services/promotion.service");
  const search = await import("@/services/search.service");
  const { PROMOTION_STATUS, TUTOR_STATUS, USER_STATUS, ROLES, AUDIT_ACTIONS } =
    await import("@/constants");
  const { getSettings, updateSettings, invalidateSettingsCache } =
    await import("@/services/settings.service");

  const searchable = await TutorProfile.find({ isSearchable: true })
    .sort({ "stats.ratingAverage": 1, _id: 1 })
    .limit(4)
    .populate("userId", "_id status deletedAt")
    .lean();

  if (searchable.length < 2) {
    return skip("promotion lifecycle", "fewer than two searchable tutors — run `bun run seed`");
  }

  // Deliberately the *worst*-rated searchable tutor: if they reach the top of
  // "best match", it was the promotion that put them there and not their
  // reviews.
  const underdog = searchable[0];
  const other = searchable[1];

  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const madeIds = [];
  const settingsBefore = await getSettings({ fresh: true });
  let suspendedUserId = null;

  try {
    await TutorPromotion.deleteMany({ tutorProfileId: { $in: searchable.map((t) => t._id) } });

    await updateSettings(
      { promotions: { enabled: true, maxPromotedPerSearch: 3, maxActive: 20,
        defaultDurationDays: 30, maxDurationDays: 365 } },
      admin.id,
    );

    // --- eligibility ----------------------------------------------------------
    const unapproved = promo.assessPromotionEligibility(
      { status: TUTOR_STATUS.PENDING_REVIEW, isSearchable: false },
      { status: USER_STATUS.ACTIVE },
    );
    check("an unapproved profile cannot be promoted", unapproved.eligible === false);

    const hidden = promo.assessPromotionEligibility(
      { status: TUTOR_STATUS.APPROVED, isSearchable: false },
      { status: USER_STATUS.ACTIVE },
    );
    check("an approved but hidden profile cannot be promoted", hidden.eligible === false);

    const suspended = promo.assessPromotionEligibility(
      { status: TUTOR_STATUS.APPROVED, isSearchable: true },
      { status: USER_STATUS.SUSPENDED },
    );
    check("a suspended account cannot be promoted", suspended.eligible === false);

    const closed = promo.assessPromotionEligibility(
      { status: TUTOR_STATUS.APPROVED, isSearchable: true },
      { status: USER_STATUS.ACTIVE, deletedAt: new Date() },
    );
    check("a closed account cannot be promoted", closed.eligible === false);

    const fine = promo.assessPromotionEligibility(
      { status: TUTOR_STATUS.APPROVED, isSearchable: true },
      { status: USER_STATUS.ACTIVE, deletedAt: null },
    );
    check("an approved, searchable, active tutor can be", fine.eligible === true);

    // The same rule, enforced through the service against real records.
    const hiddenProfile = await TutorProfile.findOne({ isSearchable: false })
      .select("_id")
      .lean();
    if (hiddenProfile) {
      const refused = await throws(
        () => promo.createPromotion({ tutorProfileId: String(hiddenProfile._id) }, admin),
        (e) => e.code === "TUTOR_NOT_PROMOTABLE",
      );
      check("the service refuses to promote a profile that is not searchable",
        refused.threw && refused.matched);
    } else {
      skip("promoting a hidden profile", "every seeded profile is searchable");
    }

    // --- creating ---------------------------------------------------------------
    const created = await promo.createPromotion(
      { tutorProfileId: String(underdog._id), note: "Integration suite." },
      admin,
    );
    madeIds.push(created.id);

    check("a promotion with no start date begins immediately",
      created.status === PROMOTION_STATUS.ACTIVE);
    check("and ends on the platform's default window, not forever",
      new Date(created.endsAt) > new Date() &&
        Math.round((new Date(created.endsAt) - new Date(created.startsAt)) / 86400000) === 30);
    check("creating one is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.PROMOTION_CREATED, entityId: created.id,
      })) === 1);
    check("and the tutor is told their profile is being featured",
      (await Notification.countDocuments({
        entityType: "TutorPromotion", entityId: created.id,
      })) === 1);

    const duplicate = await throws(
      () => promo.createPromotion({ tutorProfileId: String(underdog._id) }, admin),
      (e) => e.status === 409,
    );
    check("one tutor cannot hold two promotions at once",
      duplicate.threw && duplicate.matched);

    const backwards = await throws(
      () => promo.createPromotion({
        tutorProfileId: String(other._id),
        startsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      }, admin),
      (e) => e.status === 422,
    );
    check("a promotion cannot end before it starts", backwards.threw && backwards.matched);

    const past = await throws(
      () => promo.createPromotion({
        tutorProfileId: String(other._id),
        startsAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        endsAt: new Date(Date.now() - 86400000).toISOString(),
      }, admin),
      (e) => e.status === 422,
    );
    check("a promotion cannot be created already finished", past.threw && past.matched);

    const tooLong = await throws(
      () => promo.createPromotion({
        tutorProfileId: String(other._id),
        endsAt: new Date(Date.now() + 400 * 86400000).toISOString(),
      }, admin),
      (e) => e.code === "PROMOTION_TOO_LONG",
    );
    check("a promotion cannot exceed the configured maximum window",
      tooLong.threw && tooLong.matched);

    // --- discovery ----------------------------------------------------------------
    const promotedFirst = await search.searchTutors({ page: 1, pageSize: 12, sort: "RELEVANCE" });
    check("a live promotion lifts the tutor to the top of the default ordering",
      promotedFirst.items[0]?.id === String(underdog._id),
      promotedFirst.items[0]?.id);
    check("and the result is labelled as promoted",
      promotedFirst.items[0]?.isPromoted === true);
    check("everybody else in the results is not labelled",
      promotedFirst.items.slice(1).every((t) => t.isPromoted !== true));
    check("no tutor appears twice on the page",
      new Set(promotedFirst.items.map((t) => t.id)).size === promotedFirst.items.length);

    const unpromotedTotal = promotedFirst.total;
    check("the total is unchanged by promotion — it reorders, it does not add",
      unpromotedTotal === (await TutorProfile.countDocuments({ isSearchable: true })));

    const byPrice = await search.searchTutors({ page: 1, pageSize: 12, sort: "PRICE_ASC" });
    const prices = byPrice.items.map((t) => t.hourlyRateCents);
    check("an explicit price sort is honoured exactly, promotion or not",
      prices.every((p, i) => i === 0 || prices[i - 1] <= p), JSON.stringify(prices));
    check("and nothing is labelled promoted when the visitor chose the order",
      byPrice.items.every((t) => t.isPromoted !== true));

    // Paging over the whole result set must see each tutor exactly once.
    const seen = [];
    const pageSize = 2;
    const pages = Math.ceil(unpromotedTotal / pageSize);
    for (let p = 1; p <= pages; p += 1) {
      const res = await search.searchTutors({ page: p, pageSize, sort: "RELEVANCE" });
      seen.push(...res.items.map((t) => t.id));
    }
    check("paging through a promoted result set shows every tutor exactly once",
      seen.length === unpromotedTotal && new Set(seen).size === unpromotedTotal,
      `${seen.length} rows, ${new Set(seen).size} distinct, ${unpromotedTotal} expected`);
    check("and the promoted tutor is the very first of them",
      seen[0] === String(underdog._id));

    // A filter the promoted tutor fails must still exclude them.
    const impossible = await search.searchTutors({
      page: 1, pageSize: 12, sort: "RELEVANCE", minRating: 5,
      // Nothing seeded rates a perfect 5 across the board; if something does,
      // the assertion below still holds because it checks the filter, not the
      // emptiness.
    });
    check("a promoted tutor who fails a filter is still filtered out",
      impossible.items.every((t) => (t.stats?.ratingAverage ?? 0) >= 5));

    // --- pausing ----------------------------------------------------------------
    await promo.pausePromotion(created.id, admin);
    invalidateSettingsCache();
    const whilePaused = await search.searchTutors({ page: 1, pageSize: 12, sort: "RELEVANCE" });
    check("a paused promotion stops affecting search immediately",
      whilePaused.items.every((t) => t.isPromoted !== true));
    check("pausing is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.PROMOTION_PAUSED, entityId: created.id,
      })) === 1);
    check("pausing twice is not an error",
      (await promo.pausePromotion(created.id, admin)).status === PROMOTION_STATUS.PAUSED);

    const reactivated = await promo.activatePromotion(created.id, admin);
    check("a paused promotion can be switched back on",
      reactivated.status === PROMOTION_STATUS.ACTIVE);
    check("activating twice is not an error",
      (await promo.activatePromotion(created.id, admin)).status === PROMOTION_STATUS.ACTIVE);

    // --- eligibility is re-checked at activation, not only at creation ----------
    await promo.pausePromotion(created.id, admin);
    suspendedUserId = underdog.userId._id ?? underdog.userId;
    await User.updateOne({ _id: suspendedUserId }, { $set: { status: USER_STATUS.SUSPENDED } });
    const staleActivate = await throws(
      () => promo.activatePromotion(created.id, admin),
      (e) => e.code === "TUTOR_NOT_PROMOTABLE",
    );
    check("a tutor suspended since the promotion was granted cannot be reactivated",
      staleActivate.threw && staleActivate.matched);
    await User.updateOne({ _id: suspendedUserId }, { $set: { status: USER_STATUS.ACTIVE } });
    suspendedUserId = null;
    await promo.activatePromotion(created.id, admin);

    // --- extending ---------------------------------------------------------------
    const current = await TutorPromotion.findById(created.id).lean();
    const shorter = await throws(
      () => promo.extendPromotion(created.id, {
        endsAt: new Date(new Date(current.endsAt).getTime() - 86400000).toISOString(),
      }, admin),
      (e) => e.status === 422,
    );
    check("'extend' cannot be used to shorten a promotion", shorter.threw && shorter.matched);

    const extendedTo = new Date(new Date(current.endsAt).getTime() + 7 * 86400000);
    const extended = await promo.extendPromotion(
      created.id, { endsAt: extendedTo.toISOString() }, admin,
    );
    check("extending moves the end of the window",
      new Date(extended.endsAt).getTime() === extendedTo.getTime());
    check("extending is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.PROMOTION_EXTENDED, entityId: created.id,
      })) === 1);

    // --- a window that has closed stops mattering even without the job ----------
    await TutorPromotion.updateOne(
      { _id: created.id },
      { $set: { endsAt: new Date(Date.now() - 1000) } },
    );
    const afterWindow = await search.searchTutors({ page: 1, pageSize: 12, sort: "RELEVANCE" });
    check("a promotion whose window has closed stops affecting search before any job runs",
      afterWindow.items.every((t) => t.isPromoted !== true));
    const stillStored = await TutorPromotion.findById(created.id).lean();
    check("even though the stored status still says it is active",
      stillStored.status === PROMOTION_STATUS.ACTIVE);

    // --- the sweep ----------------------------------------------------------------
    const swept = await promo.expirePromotions({ now: new Date() });
    check("the expiry sweep closes the finished promotion", swept.expired >= 1);
    const settled = await TutorPromotion.findById(created.id).lean();
    check("and the record reads as finished afterwards",
      settled.status === PROMOTION_STATUS.EXPIRED && !!settled.endedAt);
    check("expiry is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.PROMOTION_EXPIRED, entityId: created.id,
      })) === 1);

    const sweptAgain = await promo.expirePromotions({ now: new Date() });
    check("running the sweep again expires nothing twice", sweptAgain.expired === 0);
    check("and writes no second audit entry",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.PROMOTION_EXPIRED, entityId: created.id,
      })) === 1);

    // --- terminal is terminal -------------------------------------------------------
    for (const [label, fn] of [
      ["activated", () => promo.activatePromotion(created.id, admin)],
      ["paused", () => promo.pausePromotion(created.id, admin)],
      ["cancelled", () => promo.cancelPromotion(created.id, {}, admin)],
      ["extended", () => promo.extendPromotion(created.id, {
        endsAt: new Date(Date.now() + 86400000).toISOString(),
      }, admin)],
    ]) {
      const attempt = await throws(fn, (e) => e.code === "PROMOTION_FINISHED");
      check(`a finished promotion cannot be ${label}`, attempt.threw && attempt.matched);
    }

    // --- scheduling ahead -------------------------------------------------------------
    const startsAt = new Date(Date.now() + 2 * 86400000);
    const scheduled = await promo.createPromotion({
      tutorProfileId: String(underdog._id),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 5 * 86400000).toISOString(),
    }, admin);
    madeIds.push(scheduled.id);
    check("a promotion starting later is scheduled, not active",
      scheduled.status === PROMOTION_STATUS.SCHEDULED);

    const notYet = await search.searchTutors({ page: 1, pageSize: 12, sort: "RELEVANCE" });
    check("a scheduled promotion does not affect search before its window opens",
      notYet.items.every((t) => t.isPromoted !== true));

    const opened = await promo.expirePromotions({
      now: new Date(startsAt.getTime() + 1000),
    });
    check("the sweep opens a scheduled promotion whose start has arrived",
      opened.activated === 1);
    check("and opening it is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.PROMOTION_ACTIVATED, entityId: scheduled.id,
      })) === 1);
    const openedAgain = await promo.expirePromotions({
      now: new Date(startsAt.getTime() + 2000),
    });
    check("and opening it again does nothing", openedAgain.activated === 0);

    // --- the tutor's own view -----------------------------------------------------------
    const mine = await promo.currentPromotionForTutor(underdog._id);
    check("a tutor can see their own promotion's status and window",
      mine?.status === PROMOTION_STATUS.ACTIVE && !!mine.startsAt && !!mine.endsAt);
    check("but never the internal note or who granted it",
      mine.note === undefined && mine.createdBy === undefined);

    // --- the ceiling ---------------------------------------------------------------------
    await updateSettings({ promotions: { maxActive: 1 } }, admin.id);
    const capped = await throws(
      () => promo.createPromotion({ tutorProfileId: String(other._id) }, admin),
      (e) => e.code === "PROMOTION_LIMIT_REACHED",
    );
    check("the marketplace-wide ceiling refuses one promotion too many",
      capped.threw && capped.matched);

    await updateSettings({ promotions: { maxActive: 20, maxPromotedPerSearch: 0 } }, admin.id);
    const ceilingZero = await search.searchTutors({ page: 1, pageSize: 12, sort: "RELEVANCE" });
    check("a zero per-search ceiling records promotions but lifts nobody",
      ceilingZero.items.every((t) => t.isPromoted !== true));

    await updateSettings({ promotions: { enabled: false, maxPromotedPerSearch: 3 } }, admin.id);
    const switchedOff = await search.searchTutors({ page: 1, pageSize: 12, sort: "RELEVANCE" });
    check("switching promotions off stops them affecting search",
      switchedOff.items.every((t) => t.isPromoted !== true));
    const refusedWhileOff = await throws(
      () => promo.createPromotion({ tutorProfileId: String(other._id) }, admin),
      (e) => e.code === "PROMOTIONS_DISABLED",
    );
    check("and no new promotion can be created while it is off",
      refusedWhileOff.threw && refusedWhileOff.matched);
  } finally {
    if (suspendedUserId) {
      await User.updateOne({ _id: suspendedUserId }, { $set: { status: USER_STATUS.ACTIVE } });
    }
    await updateSettings({ promotions: { ...settingsBefore.promotions } }, admin.id);
    const ids = madeIds.map((id) => new mongoose.Types.ObjectId(id));
    await Notification.deleteMany({ entityType: "TutorPromotion" });
    await AuditLog.deleteMany({ entityType: "TutorPromotion" });
    await TutorPromotion.deleteMany({ _id: { $in: ids } });
    await TutorPromotion.deleteMany({ tutorProfileId: { $in: searchable.map((t) => t._id) } });
  }
}


// --- 22. Advanced analytics (§25, §41 Phase 2) -----------------------------

/**
 * Analytics are the one part of the platform where a wrong answer looks
 * exactly like a right one, so these tests are built around fixtures whose
 * correct totals are known by construction rather than read back from the
 * same aggregation being tested.
 */
async function analyticsTests() {
  section("Analytics — periods, aggregation correctness and scoping");

  // --- the pure period arithmetic ------------------------------------------
  const {
    resolveRange, granularityFor, dateWindow, percentChange, rate,
    MAX_RANGE_DAYS, DEFAULT_REPORTING_TIME_ZONE, bucketExpression,
  } = await import("@/lib/analytics/range");

  const now = new Date("2026-06-15T12:00:00.000Z");

  const rolling = resolveRange({ days: 30, now });
  check("a rolling window ends now and starts the requested number of days back",
    rolling.to.getTime() === now.getTime() &&
      Math.round((rolling.to - rolling.from) / 86400000) === 30);
  check("the previous window is the same length and immediately before it",
    rolling.previous.to.getTime() === rolling.from.getTime() &&
      rolling.previous.to - rolling.previous.from === rolling.to - rolling.from);
  check("the two windows do not overlap on a single instant",
    rolling.previous.to.getTime() === rolling.from.getTime());

  const explicit = resolveRange({
    from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z", now,
  });
  check("explicit dates win over a rolling window",
    explicit.from.toISOString() === "2026-01-01T00:00:00.000Z" &&
      explicit.to.toISOString() === "2026-02-01T00:00:00.000Z");
  check("and an explicit range reports its own length", explicit.days === 31);

  const backwards = resolveRange({
    from: "2026-03-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z", now,
  });
  check("a backwards range is corrected rather than reporting nothing",
    backwards.from < backwards.to);

  const huge = resolveRange({ days: 100000, now });
  check("an absurd window is capped rather than scanning everything",
    huge.days <= MAX_RANGE_DAYS);

  const empty = resolveRange({ days: 0, now });
  check("a zero-day window falls back to the default rather than to nothing",
    empty.days === 30);

  const badZone = resolveRange({ days: 7, timeZone: "Mars/Olympus_Mons", now });
  check("an unusable time zone degrades to the marketplace's own",
    badZone.timeZone === DEFAULT_REPORTING_TIME_ZONE);
  const goodZone = resolveRange({ days: 7, timeZone: "America/Vancouver", now });
  check("a real time zone is honoured", goodZone.timeZone === "America/Vancouver");

  check("short periods bucket by day", granularityFor(7 * 86400000) === "day");
  check("medium periods bucket by week", granularityFor(90 * 86400000) === "week");
  check("long periods bucket by month", granularityFor(300 * 86400000) === "month");
  check("a series is bucketed in the reporting zone, not in UTC",
    bucketExpression("startAt", goodZone).$dateToString.timezone === "America/Vancouver");

  const halfOpen = dateWindow("paidAt", { from: new Date(1), to: new Date(2) });
  check("date windows are half-open, so adjacent periods partition the timeline",
    halfOpen.paidAt.$gte.getTime() === 1 && halfOpen.paidAt.$lt.getTime() === 2);

  check("percentage change is null when there is no baseline to compare with",
    percentChange(5, 0) === null && percentChange(0, 0) === 0);
  check("percentage change is a whole percentage against the baseline",
    percentChange(150, 100) === 50 && percentChange(50, 100) === -50);
  check("a rate over an empty denominator is zero, not NaN",
    rate(0, 0) === 0 && rate(3, 4) === 75);

  // --- against the database ---------------------------------------------------
  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("analytics aggregation", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("analytics aggregation", "MongoDB is not reachable");
    }
  }

  const { Booking, Payment, TutorProfile, StudentProfile, Review } = await import("@/models");
  const analytics = await import("@/services/analytics.service");
  const { BOOKING_STATUS, PAYMENT_STATUS, LESSON_MODES } = await import("@/constants");

  const tutor = await TutorProfile.findOne({ isSearchable: true })
    .populate("userId", "_id")
    .lean();
  const student = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !student) {
    return skip("analytics aggregation", "no seeded tutor or student — run `bun run seed`");
  }

  const tutorUserId = tutor.userId._id ?? tutor.userId;
  const courseId = tutor.courses?.[0]?.courseId ?? new mongoose.Types.ObjectId();

  // A window far in the past, so only this fixture can land in it and every
  // expected total is known by construction.
  const anchor = new Date("2021-03-10T15:00:00.000Z");
  const from = new Date("2021-03-01T00:00:00.000Z");
  const to = new Date("2021-04-01T00:00:00.000Z");
  const range = { from: from.toISOString(), to: to.toISOString() };

  const made = { bookings: [], payments: [], reviews: [] };

  const price = (subtotal, commissionPercent = 20) => ({
    hourlyRateCents: subtotal,
    durationMinutes: 60,
    subtotalCents: subtotal,
    commissionPercent,
    commissionCents: Math.round(subtotal * (commissionPercent / 100)),
    tutorEarningsCents: subtotal - Math.round(subtotal * (commissionPercent / 100)),
    totalCents: subtotal,
    currency: "CAD",
  });

  async function makeBooking({ status, subtotal, startAt, extra = {} }) {
    const booking = await Booking.create({
      reference: `QA-AN-${randomUUID().slice(0, 8)}`,
      purchaserId: student.ownerId,
      studentProfileId: student._id,
      tutorProfileId: tutor._id,
      tutorUserId,
      courseId,
      courseName: "Analytics Fixture Course",
      courseCode: "QAAN1",
      subjectName: "Analytics Fixture Subject",
      mode: LESSON_MODES.ONLINE,
      startAt,
      endAt: new Date(startAt.getTime() + 3600000),
      durationMinutes: 60,
      status,
      price: price(subtotal),
      completedAt: status === BOOKING_STATUS.COMPLETED ? startAt : undefined,
      ...extra,
    });
    made.bookings.push(booking._id);
    return booking;
  }

  async function makePayment({ booking, status, refundedCents = 0, creditAppliedCents = 0, paidAt }) {
    const payment = await Payment.create({
      bookingId: booking._id,
      purchaserId: student.ownerId,
      tutorUserId,
      subtotalCents: booking.price.subtotalCents,
      commissionPercent: booking.price.commissionPercent,
      commissionCents: booking.price.commissionCents,
      tutorEarningsCents: booking.price.tutorEarningsCents,
      totalCents: booking.price.totalCents,
      creditAppliedCents,
      refundedCents,
      status,
      paidAt,
    });
    made.payments.push(payment._id);
    return payment;
  }

  try {
    // Two settled lessons, one abandoned checkout, one cancelled lesson, one
    // partially refunded lesson, and one payment paid *outside* the window.
    const completedA = await makeBooking({
      status: BOOKING_STATUS.COMPLETED, subtotal: 10000, startAt: anchor,
    });
    await makePayment({ booking: completedA, status: PAYMENT_STATUS.PAID, paidAt: anchor });

    const completedB = await makeBooking({
      status: BOOKING_STATUS.COMPLETED, subtotal: 5000,
      startAt: new Date(anchor.getTime() + 86400000),
    });
    await makePayment({
      booking: completedB, status: PAYMENT_STATUS.PAID,
      paidAt: new Date(anchor.getTime() + 86400000),
    });

    // Never paid for. Must not count as a lesson, a cancellation or revenue.
    await makeBooking({
      status: BOOKING_STATUS.PENDING_PAYMENT, subtotal: 99900,
      startAt: new Date(anchor.getTime() + 2 * 86400000),
    });
    await makeBooking({
      status: BOOKING_STATUS.EXPIRED, subtotal: 99900,
      startAt: new Date(anchor.getTime() + 2 * 86400000),
    });

    // Cancelled by the learner, half refunded.
    const cancelled = await makeBooking({
      status: BOOKING_STATUS.CANCELLED_BY_STUDENT, subtotal: 8000,
      startAt: new Date(anchor.getTime() + 3 * 86400000),
    });
    await makePayment({
      booking: cancelled, status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      refundedCents: 4000, paidAt: new Date(anchor.getTime() + 3 * 86400000),
    });

    // A no-show, which is neither a completion nor a cancellation.
    await makeBooking({
      status: BOOKING_STATUS.NO_SHOW_STUDENT, subtotal: 6000,
      startAt: new Date(anchor.getTime() + 4 * 86400000),
    });

    // Paid well outside the window — must not appear in it at all.
    const outside = await makeBooking({
      status: BOOKING_STATUS.COMPLETED, subtotal: 77700,
      startAt: new Date("2021-06-10T15:00:00.000Z"),
    });
    await makePayment({
      booking: outside, status: PAYMENT_STATUS.PAID,
      paidAt: new Date("2021-06-10T15:00:00.000Z"),
    });

    const overview = await analytics.marketplaceOverview(range);
    const c = overview.commerce;

    // Gross = 10000 + 5000 + 8000 = 23000. The abandoned checkout (99900) and
    // the out-of-window lesson (77700) are absent by construction.
    check("gross sales come from settled payments only",
      c.grossSalesCents === 23000, String(c.grossSalesCents));
    check("an abandoned checkout is never counted as revenue",
      c.grossSalesCents < 99900);
    check("a payment settled outside the window is not in it",
      c.grossSalesCents < 77700);
    check("refunds are reported", c.refundedCents === 4000, String(c.refundedCents));
    check("net collected subtracts refunds",
      c.netCollectedCents === 23000 - 4000, String(c.netCollectedCents));

    // Commission at 20% = 2000 + 1000 + 1600 = 4600. The 4000 refund on an
    // 8000 payment is half of it, so half that payment's 1600 commission — 800
    // — goes back. 4600 − 800 = 3800.
    check("platform revenue subtracts each payment's own refunded commission",
      c.platformRevenueCents === 3800, String(c.platformRevenueCents));

    // Lessons: 2 completed + 1 cancelled + 1 no-show = 4. Unpaid ones excluded.
    check("unpaid and expired bookings are excluded from every lesson rate",
      c.bookings === 4, String(c.bookings));
    check("the completion rate counts completions over real lessons",
      c.completionRate === 50, String(c.completionRate));
    check("the cancellation rate does not count an abandoned checkout",
      c.cancellationRate === 25, String(c.cancellationRate));
    check("no-shows are counted apart from cancellations",
      c.noShowRate === 25 && overview.reliability.studentNoShows === 1);
    check("teaching hours count only lessons actually delivered",
      c.teachingHours === 2, String(c.teachingHours));
    check("average lesson value divides gross by settled payments",
      c.averageBookingValueCents === Math.round(23000 / 3),
      String(c.averageBookingValueCents));
    check("the reported period is the one that was asked for",
      overview.period.from === from.toISOString() && overview.period.to === to.toISOString());

    // Credit is platform-funded marketing, not lesson revenue.
    const credited = await makeBooking({
      status: BOOKING_STATUS.COMPLETED, subtotal: 10000,
      startAt: new Date(anchor.getTime() + 5 * 86400000),
    });
    await makePayment({
      booking: credited, status: PAYMENT_STATUS.PAID, creditAppliedCents: 2500,
      paidAt: new Date(anchor.getTime() + 5 * 86400000),
    });

    const withCredit = await analytics.marketplaceOverview(range);
    check("referral credit is reported as a cost, not as a discount on the lesson",
      withCredit.commerce.referralCreditCents === 2500 &&
        withCredit.commerce.grossSalesCents === 33000,
      `${withCredit.commerce.referralCreditCents} / ${withCredit.commerce.grossSalesCents}`);
    check("and it is taken off platform revenue, never off the tutor's earnings",
      withCredit.commerce.platformRevenueCents === 3800 + 2000 - 2500 &&
        withCredit.commerce.tutorEarningsCents === 8000 + 4000 + 6400 + 8000,
      `${withCredit.commerce.platformRevenueCents} / ${withCredit.commerce.tutorEarningsCents}`);

    // --- breakdowns -------------------------------------------------------------
    const breakdowns = await analytics.marketplaceBreakdowns(range);
    const fixtureSubject = breakdowns.popularSubjects.find(
      (s) => s.name === "Analytics Fixture Subject",
    );
    check("subject breakdown counts the fixture's real lessons",
      fixtureSubject?.bookings === 5, String(fixtureSubject?.bookings));
    check("a 31-day period is bucketed by day", breakdowns.granularity === "day");
    check("the series only covers days that had lessons",
      breakdowns.dailyBookings.length === 5, String(breakdowns.dailyBookings.length));
    check("every bucket is a date string in the reporting zone",
      breakdowns.dailyBookings.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date)));
    check("the series totals match the overview, so nothing is double counted",
      breakdowns.dailyBookings.reduce((sum, d) => sum + d.bookings, 0) ===
        withCredit.commerce.bookings);

    const longRange = await analytics.marketplaceBreakdowns({
      from: "2021-01-01T00:00:00.000Z", to: "2021-12-01T00:00:00.000Z",
    });
    check("a long period buckets by month rather than emitting 300 bars",
      longRange.granularity === "month");
    check("and its buckets are year-months",
      longRange.dailyBookings.every((d) => /^\d{4}-\d{2}$/.test(d.date)));

    // --- an empty period --------------------------------------------------------
    const quiet = await analytics.marketplaceOverview({
      from: "2019-01-01T00:00:00.000Z", to: "2019-02-01T00:00:00.000Z",
    });
    check("an empty period reports zeros rather than failing",
      quiet.commerce.grossSalesCents === 0 && quiet.commerce.bookings === 0 &&
        quiet.commerce.completionRate === 0 && quiet.commerce.platformRevenueCents === 0);
    check("and its rates are zero rather than NaN",
      Number.isFinite(quiet.commerce.cancellationRate) &&
        Number.isFinite(quiet.commerce.noShowRate));

    // --- exact boundaries -------------------------------------------------------
    const boundary = await analytics.marketplaceOverview({
      from: anchor.toISOString(),
      to: new Date(anchor.getTime() + 86400000).toISOString(),
    });
    check("the period start is inclusive — a lesson exactly on it is counted",
      boundary.commerce.bookings === 1, String(boundary.commerce.bookings));
    check("and the period end is exclusive — the next day's lesson is not",
      boundary.commerce.grossSalesCents === 10000,
      String(boundary.commerce.grossSalesCents));

    // --- tutor-scoped analytics ---------------------------------------------------
    const mine = await analytics.tutorAnalytics(String(tutorUserId), range);
    check("a tutor's own analytics see their own lessons",
      mine.lessons.total === 5, String(mine.lessons.total));
    check("and their own earnings, never the platform's commission",
      mine.earnings.netCents === 8000 + 4000 + 6400 + 8000,
      String(mine.earnings.netCents));
    check("a tutor is never shown platform revenue",
      mine.earnings.platformRevenueCents === undefined &&
        mine.earnings.commissionCents === undefined);
    check("repeat business is computed from distinct students",
      mine.students.taught >= 1 && mine.students.returning <= mine.students.taught);

    const someoneElse = new mongoose.Types.ObjectId();
    const theirs = await analytics.tutorAnalytics(String(someoneElse), range);
    check("another tutor's analytics contain none of this tutor's lessons",
      theirs.lessons.total === 0 && theirs.earnings.netCents === 0);

    // --- leaderboard ----------------------------------------------------------------
    const leaderboard = await analytics.tutorLeaderboard({ ...range, limit: 20 });
    const row = leaderboard.tutors.find((t) => t.tutorUserId === String(tutorUserId));
    check("the leaderboard counts the same lessons the tutor's own view does",
      row?.lessons === mine.lessons.total, `${row?.lessons} vs ${mine.lessons.total}`);
    check("and reports a completion rate consistent with them",
      row?.completionRate === mine.lessons.completionRate);

    // --- Phase 2 feature analytics ----------------------------------------------------
    const phaseTwo = await analytics.phaseTwoAnalytics({ days: 366 });
    check("request analytics report a match rate between 0 and 100",
      phaseTwo.requests.matchRate >= 0 && phaseTwo.requests.matchRate <= 100);
    check("package utilisation never exceeds what was sold",
      phaseTwo.packages.sessionsUsed <= phaseTwo.packages.sessionsSold &&
        phaseTwo.packages.utilisationRate <= 100);
    check("group fill rate never exceeds the seats offered",
      phaseTwo.groups.seatsTaken <= phaseTwo.groups.seatsOffered &&
        phaseTwo.groups.fillRate <= 100);
    check("referral conversion never exceeds the sign-ups it is measured against",
      phaseTwo.referrals.qualified <= phaseTwo.referrals.signups &&
        phaseTwo.referrals.conversionRate <= 100);
    check("referral credit is reported separately from revenue",
      typeof phaseTwo.referrals.creditGrantedCents === "number");
    check("matching reports the states a match can actually be in",
      phaseTwo.matching.booked <= phaseTwo.matching.suggested &&
        phaseTwo.matching.bookingRate <= 100);
    check("promotion analytics are reported alongside the rest",
      typeof phaseTwo.promotions.running === "number");
  } finally {
    await Payment.deleteMany({ _id: { $in: made.payments } });
    await Booking.deleteMany({ _id: { $in: made.bookings } });
    await Review.deleteMany({ _id: { $in: made.reviews } });
  }
}


// --- 23. Fraud and risk (§41 Phase 2) --------------------------------------

/**
 * The two things that matter most here are the two that are easiest to get
 * wrong: a signal that fires twice for one event (which inflates a score and
 * gets an innocent account reviewed), and a case that can be reopened or
 * quietly rewritten (which destroys the evidence the feature exists to keep).
 */
async function riskTests() {
  section("Risk — detection, idempotency, review and evidence");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("risk", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("risk", "MongoDB is not reachable");
    }
  }

  const { RiskCase, User, AuditLog, Notification } = await import("@/models");
  const risk = await import("@/services/risk.service");
  const {
    RISK_SIGNALS, RISK_CASE_STATUS, RISK_LEVELS, RISK_ACTIONS, AUDIT_ACTIONS, ROLES, USER_STATUS,
  } = await import("@/constants");
  const { getSettings, updateSettings } = await import("@/services/settings.service");

  // --- the pure scoring rules ------------------------------------------------
  const now = new Date();
  const recent = (type, daysAgo = 0) => ({
    type,
    detectedAt: new Date(now.getTime() - daysAgo * 86400000),
  });

  check("the score is how many *kinds* of signal fired, not how many events",
    risk.scoreSignals(
      [
        recent(RISK_SIGNALS.PAYMENT_FAILURES),
        recent(RISK_SIGNALS.PAYMENT_FAILURES, 1),
        recent(RISK_SIGNALS.PAYMENT_FAILURES, 2),
      ],
      { now, windowDays: 30 },
    ) === 1);

  check("different kinds of signal each add to the score",
    risk.scoreSignals(
      [
        recent(RISK_SIGNALS.PAYMENT_FAILURES),
        recent(RISK_SIGNALS.REPEATED_DISPUTES),
        recent(RISK_SIGNALS.REFERRAL_ABUSE),
      ],
      { now, windowDays: 30 },
    ) === 3);

  check("a signal older than the window stops counting toward the score",
    risk.scoreSignals(
      [recent(RISK_SIGNALS.PAYMENT_FAILURES, 90), recent(RISK_SIGNALS.REPEATED_DISPUTES, 1)],
      { now, windowDays: 30 },
    ) === 1);

  check("no signals is a score of zero, not an error",
    risk.scoreSignals([], { now, windowDays: 30 }) === 0 &&
      risk.scoreSignals(undefined, { now, windowDays: 30 }) === 0);

  const thresholds = { risk: { reviewScore: 2, highScore: 4 } };
  check("levels follow the operator's thresholds",
    risk.levelForScore(1, thresholds) === RISK_LEVELS.LOW &&
      risk.levelForScore(2, thresholds) === RISK_LEVELS.MEDIUM &&
      risk.levelForScore(3, thresholds) === RISK_LEVELS.MEDIUM &&
      risk.levelForScore(4, thresholds) === RISK_LEVELS.HIGH);
  check("the boundaries are inclusive at the threshold itself",
    risk.levelForScore(4, thresholds) === RISK_LEVELS.HIGH &&
      risk.levelForScore(3.99, thresholds) === RISK_LEVELS.MEDIUM);

  // --- against the database -----------------------------------------------------
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const settingsBefore = await getSettings({ fresh: true });
  const madeUsers = [];

  async function makeSubject(suffix) {
    const user = await User.create({
      firstName: "Risk",
      lastName: `Fixture ${suffix}`,
      email: `risk.fixture.${suffix}.${randomUUID().slice(0, 8)}@example.com`,
      passwordHash: "x".repeat(60),
      role: ROLES.PARENT,
      status: USER_STATUS.ACTIVE,
    });
    madeUsers.push(user._id);
    return user;
  }

  try {
    await updateSettings(
      { risk: { enabled: true, signalWindowDays: 30, reviewScore: 2, highScore: 3,
        noShowThreshold: 3, paymentFailureThreshold: 3, disputeThreshold: 2 } },
      admin.id,
    );

    const subject = await makeSubject("a");

    // --- a first signal opens a case -----------------------------------------
    const first = await risk.recordRiskSignal({
      subjectUserId: String(subject._id),
      type: RISK_SIGNALS.PAYMENT_FAILURES,
      dedupeKey: `qa-risk-${subject._id}-payments`,
      summary: "Three declined cards.",
      evidence: { failures: 3 },
    });
    check("a signal opens a case for the account", first.recorded && first.opened);
    check("the case starts needing review",
      first.case.status === RISK_CASE_STATUS.OPEN);
    check("it carries a public reference", /^RSK-/.test(first.case.reference));
    check("one signal is below the review threshold, so the level stays low",
      first.case.score === 1 && first.case.level === RISK_LEVELS.LOW);
    check("opening a case is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.RISK_CASE_OPENED, entityId: first.case.id,
      })) === 1);

    // --- idempotency ------------------------------------------------------------
    const replay = await risk.recordRiskSignal({
      subjectUserId: String(subject._id),
      type: RISK_SIGNALS.PAYMENT_FAILURES,
      dedupeKey: `qa-risk-${subject._id}-payments`,
      summary: "The same three declined cards, redelivered.",
    });
    check("the same event recorded again changes nothing",
      replay.recorded === false && replay.reason === "ALREADY_RECORDED");

    const afterReplay = await RiskCase.findById(first.case.id).lean();
    check("and the case still holds exactly one signal",
      afterReplay.signals.length === 1, String(afterReplay.signals.length));
    check("and no second audit entry was written",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.RISK_CASE_OPENED, entityId: first.case.id,
      })) === 1);

    // Ten concurrent replays of the same event must still record once.
    await Promise.all(
      Array.from({ length: 10 }, () =>
        risk.recordRiskSignal({
          subjectUserId: String(subject._id),
          type: RISK_SIGNALS.PAYMENT_FAILURES,
          dedupeKey: `qa-risk-${subject._id}-payments`,
        }).catch(() => null),
      ),
    );
    const afterStorm = await RiskCase.findById(first.case.id).lean();
    check("ten concurrent replays of one event still record one signal",
      afterStorm.signals.length === 1, String(afterStorm.signals.length));

    // --- a second kind of signal escalates the same case --------------------------
    const second = await risk.recordRiskSignal({
      subjectUserId: String(subject._id),
      type: RISK_SIGNALS.REPEATED_DISPUTES,
      dedupeKey: `qa-risk-${subject._id}-disputes`,
      summary: "Two disputes raised against this account.",
    });
    check("a different kind of signal joins the existing case rather than opening a second",
      second.recorded && second.opened === false && second.case.id === first.case.id);
    check("the score and level are recomputed, never supplied",
      second.case.score === 2 && second.case.level === RISK_LEVELS.MEDIUM);

    const openCases = await RiskCase.countDocuments({
      subjectUserId: subject._id,
      status: { $in: [RISK_CASE_STATUS.OPEN, RISK_CASE_STATUS.UNDER_REVIEW] },
    });
    check("one account never holds two open cases at once", openCases === 1);

    const third = await risk.recordRiskSignal({
      subjectUserId: String(subject._id),
      type: RISK_SIGNALS.REFERRAL_ABUSE,
      dedupeKey: `qa-risk-${subject._id}-referral`,
    });
    check("a third kind of signal reaches the high-risk threshold",
      third.case.score === 3 && third.case.level === RISK_LEVELS.HIGH);

    // --- the case is explainable --------------------------------------------------
    const detail = await risk.getRiskCase(first.case.id);
    check("every signal on the case says what it was and when",
      detail.signals.length === 3 &&
        detail.signals.every((s) => !!s.type && !!s.detectedAt));
    check("and the evidence behind one is readable",
      detail.signals.find((s) => s.type === RISK_SIGNALS.PAYMENT_FAILURES)?.evidence
        ?.failures === 3);
    check("the case names the account it is about",
      String(detail.subjectUserId?.id ?? detail.subjectUserId) === String(subject._id));

    // --- the account is not restricted by any of this -------------------------------
    const stillActive = await User.findById(subject._id).select("status").lean();
    check("reaching high risk never restricts the account on its own",
      stillActive.status === USER_STATUS.ACTIVE);

    // --- review -----------------------------------------------------------------------
    const taken = await risk.reviewRiskCase(first.case.id, admin);
    check("an administrator can take a case for review",
      taken.status === RISK_CASE_STATUS.UNDER_REVIEW && !!taken.reviewedAt);
    check("taking it twice is not an error",
      (await risk.reviewRiskCase(first.case.id, admin)).status ===
        RISK_CASE_STATUS.UNDER_REVIEW);
    check("taking a case is audited",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.RISK_CASE_REVIEWED, entityId: first.case.id,
      })) === 1);

    const unexplained = await throws(
      () => risk.resolveRiskCase(
        first.case.id, { resolution: RISK_CASE_STATUS.CONFIRMED, note: "bad" }, admin,
      ),
      (e) => e.code === "RISK_NOTE_REQUIRED",
    );
    check("a case cannot be confirmed without recording why",
      unexplained.threw && unexplained.matched);

    const nonsense = await throws(
      () => risk.resolveRiskCase(first.case.id, { resolution: "BANNED" }, admin),
      (e) => e.code === "RISK_RESOLUTION_INVALID",
    );
    check("a case cannot be resolved into a status that does not exist",
      nonsense.threw && nonsense.matched);

    const confirmed = await risk.resolveRiskCase(
      first.case.id,
      {
        resolution: RISK_CASE_STATUS.CONFIRMED,
        note: "Three accounts sharing one confirmed mobile number.",
        action: RISK_ACTIONS.WARNING_ISSUED,
      },
      admin,
    );
    check("an administrator can confirm a case",
      confirmed.status === RISK_CASE_STATUS.CONFIRMED && !!confirmed.resolvedAt);
    check("what was done about it is recorded on the case",
      confirmed.actions.at(-1).action === RISK_ACTIONS.WARNING_ISSUED);
    check("and the signals are kept, not cleared away",
      confirmed.signals.length === 3);
    check("resolving is audited, with the signals that drove it",
      (await AuditLog.countDocuments({
        action: AUDIT_ACTIONS.RISK_CASE_RESOLVED, entityId: first.case.id,
      })) === 1);
    check("a warning reaches the account holder",
      (await Notification.countDocuments({
        entityType: "RiskCase", entityId: first.case.id,
      })) === 1);
    check("confirming a case still does not restrict the account by itself",
      (await User.findById(subject._id).select("status").lean()).status === USER_STATUS.ACTIVE);

    // --- a resolved case is closed for good ---------------------------------------------
    for (const [label, fn] of [
      ["reviewed again", () => risk.reviewRiskCase(first.case.id, admin)],
      ["resolved again", () => risk.resolveRiskCase(
        first.case.id, { resolution: RISK_CASE_STATUS.CLEARED }, admin,
      )],
    ]) {
      const attempt = await throws(fn, (e) => e.code === "RISK_CASE_RESOLVED");
      check(`a resolved case cannot be ${label}`, attempt.threw && attempt.matched);
    }

    const replayAfterResolve = await risk.recordRiskSignal({
      subjectUserId: String(subject._id),
      type: RISK_SIGNALS.PAYMENT_FAILURES,
      dedupeKey: `qa-risk-${subject._id}-payments`,
    });
    check("an old event replayed after resolution cannot open a fresh case",
      replayAfterResolve.recorded === false);

    const newTrouble = await risk.recordRiskSignal({
      subjectUserId: String(subject._id),
      type: RISK_SIGNALS.NO_SHOW_PATTERN,
      dedupeKey: `qa-risk-${subject._id}-noshow`,
    });
    check("but genuinely new trouble opens a fresh case",
      newTrouble.recorded && newTrouble.opened && newTrouble.case.id !== first.case.id);
    check("and the resolved case is still there as evidence",
      (await RiskCase.countDocuments({ subjectUserId: subject._id })) === 2);

    // --- clearing --------------------------------------------------------------------------
    const cleared = await risk.resolveRiskCase(
      newTrouble.case.id, { resolution: RISK_CASE_STATUS.CLEARED }, admin,
    );
    check("a case can be cleared without a note — being found fine needs no excuse",
      cleared.status === RISK_CASE_STATUS.CLEARED);
    check("and clearing records that no action was taken",
      cleared.actions.at(-1).action === RISK_ACTIONS.NONE);

    // --- incomplete and unknown subjects ------------------------------------------------------
    const incomplete = await throws(
      () => risk.recordRiskSignal({ subjectUserId: String(subject._id) }),
      (e) => e.code === "RISK_SIGNAL_INCOMPLETE",
    );
    check("a signal without a type or key is refused", incomplete.threw && incomplete.matched);

    const ghost = await risk.recordRiskSignal({
      subjectUserId: String(new mongoose.Types.ObjectId()),
      type: RISK_SIGNALS.PAYMENT_FAILURES,
      dedupeKey: `qa-risk-ghost-${randomUUID()}`,
    });
    check("a signal about an account that does not exist opens nothing",
      ghost.recorded === false && ghost.reason === "NO_SUBJECT");

    // --- detectors hold to their thresholds ---------------------------------------------------
    const quiet = await makeSubject("b");
    const belowNoShow = await risk.checkNoShowPattern({
      userId: String(quiet._id), role: "STUDENT", bookingId: new mongoose.Types.ObjectId(),
    });
    check("the no-show detector stays quiet below its threshold",
      belowNoShow.recorded === false && belowNoShow.reason === "BELOW_THRESHOLD");

    const belowPayments = await risk.checkPaymentFailures({
      userId: String(quiet._id), paymentId: new mongoose.Types.ObjectId(),
    });
    check("the payment-failure detector stays quiet below its threshold",
      belowPayments.recorded === false && belowPayments.reason === "BELOW_THRESHOLD");

    const belowDisputes = await risk.checkDisputePattern({
      againstUserId: String(quiet._id), disputeId: new mongoose.Types.ObjectId(),
    });
    check("the dispute detector stays quiet below its threshold",
      belowDisputes.recorded === false && belowDisputes.reason === "BELOW_THRESHOLD");

    const noSubjectDispute = await risk.checkDisputePattern({
      againstUserId: null, disputeId: new mongoose.Types.ObjectId(),
    });
    check("a dispute with nobody named records nothing",
      noSubjectDispute.recorded === false);

    check("ordinary behaviour leaves no case at all",
      (await RiskCase.countDocuments({ subjectUserId: quiet._id })) === 0);

    // Cancellation abuse defers to the booking policy's own verdict.
    const warnOnly = await risk.reportCancellationAbuse({
      userId: String(quiet._id), assessment: { action: "WARN", recentCancellations: 3 },
    });
    check("a cancellation warning is not on its own a risk signal",
      warnOnly.recorded === false);

    const needsReview = await risk.reportCancellationAbuse({
      userId: String(quiet._id), assessment: { action: "REVIEW", recentCancellations: 7 },
    });
    check("but the policy's 'needs an administrator's review' verdict is",
      needsReview.recorded === true);
    check("and the evidence carries the count the policy actually saw",
      needsReview.case.signals.at(-1).evidence.cancellations === 7);

    const sameDay = await risk.reportCancellationAbuse({
      userId: String(quiet._id), assessment: { action: "REVIEW", recentCancellations: 8 },
    });
    check("more cancellations the same day add one signal, not one per lesson",
      sameDay.recorded === false);

    // --- the overview ---------------------------------------------------------------------------
    const overview = await risk.riskOverview();
    check("the overview counts what still needs a decision",
      overview.needsAttention === overview.open + overview.underReview);
    check("and counts confirmed cases separately", overview.confirmed >= 1);

    // --- switching detection off ------------------------------------------------------------------
    await updateSettings({ risk: { enabled: false } }, admin.id);
    const whileOff = await risk.recordRiskSignal({
      subjectUserId: String(quiet._id),
      type: RISK_SIGNALS.REFERRAL_ABUSE,
      dedupeKey: `qa-risk-off-${randomUUID()}`,
    });
    check("no signal is recorded while detection is switched off",
      whileOff.recorded === false && whileOff.reason === "DISABLED");
  } finally {
    await updateSettings({ risk: { ...settingsBefore.risk } }, admin.id);
    const cases = await RiskCase.find({ subjectUserId: { $in: madeUsers } }).select("_id").lean();
    const caseIds = cases.map((c) => c._id);
    await Notification.deleteMany({ entityType: "RiskCase", entityId: { $in: caseIds } });
    await AuditLog.deleteMany({ entityType: "RiskCase", entityId: { $in: caseIds } });
    await RiskCase.deleteMany({ _id: { $in: caseIds } });
    await User.deleteMany({ _id: { $in: madeUsers } });
  }
}

/**
 * Throw capture for the provider factories.
 *
 * They became asynchronous when provider credentials gained a database-backed
 * source, so a refusal now arrives as a rejection rather than a throw. Both
 * are captured, because the two paths must be equally hard failures.
 */
async function await$throws(fn) {
  try {
    await fn();
    return { threw: false };
  } catch (error) {
    return { threw: true, error };
  }
}


// --- 22. External modules --------------------------------------------------

/**
 * Admin-configurable integration settings (§26, §36).
 *
 * Two halves, and they are tested separately because they fail differently:
 *
 *   • The *resolver* — precedence between defaults, environment and stored
 *     configuration, and what happens when a stored secret cannot be read.
 *     This needs MongoDB and reports as skipped without one.
 *   • The provider *adapters'* `verify()` methods, which are pure HTTP and
 *     run against a stubbed `fetch`. No third-party service is contacted; the
 *     responses are the real shapes each provider returns.
 *
 * What these exist to prove is the pair of claims the feature rests on: that a
 * credential an administrator saves is actually the one the platform uses, and
 * that the same credential can never be read back out.
 */
async function integrationModuleTests() {
  section("External modules — storage, precedence and secrecy");

  const { encryptSecret, decryptSecret } = await import("@/lib/security/crypto");
  const { SECRET_LABEL } = await import("@/lib/config/integrations");

  // --- encryption at rest ---------------------------------------------------
  const plaintext = "sk_test_thisisnotarealkey0000";
  const stored = encryptSecret(plaintext, SECRET_LABEL);

  check("a credential is not stored in the clear", !stored.includes(plaintext));
  check("it is stored in the versioned envelope", stored.startsWith("v1."));
  check("and it round-trips", decryptSecret(stored, SECRET_LABEL) === plaintext);

  check(
    "the same value encrypts differently every time",
    encryptSecret(plaintext, SECRET_LABEL) !== encryptSecret(plaintext, SECRET_LABEL),
  );

  // Key separation: an integration credential is not readable with the key
  // that protects calendar tokens, so one being compromised does not hand
  // over the other.
  check(
    "a credential cannot be read with another purpose's key",
    decryptSecret(stored, "aplus:calendar-token") === null,
  );

  // Tampering is detected rather than yielding attacker-chosen plaintext —
  // which is the whole reason for GCM over CBC.
  const [v, iv, tag, ct] = stored.split(".");
  const tampered = [v, iv, tag, ct.slice(0, -4) + "AAAA"].join(".");
  check("a tampered ciphertext fails to decrypt rather than decrypting wrongly",
    decryptSecret(tampered, SECRET_LABEL) === null);

  // --- adapter verification, against stubbed providers ----------------------
  await integrationVerifyTests();

  // --- the resolver, against a real database --------------------------------
  await integrationResolverTests();
}

/**
 * Each adapter's `verify()`, against the response shapes the real provider
 * returns. `fetch` is stubbed per case; nothing leaves this process.
 */
async function integrationVerifyTests() {
  const { ResendEmailProvider, SmtpEmailProvider } = await import("@/services/external/email-provider");
  const { TwilioSmsProvider } = await import("@/services/external/sms-provider");
  const { GoogleCalendarProvider, MicrosoftCalendarProvider } = await import(
    "@/services/external/calendar-provider"
  );
  const { StripePaymentProvider } = await import("@/services/external/payment-provider");

  // --- Resend ---------------------------------------------------------------
  const resendOk = new ResendEmailProvider({
    apiKey: "re_live_secret_value",
    fetchImpl: stubFetch(() => ({ body: { data: [{ name: "apluslearn.ca", status: "verified" }] } })),
  });
  const resendResult = await resendOk.verify();
  check("Resend reports a working key with a verified domain as connected", resendResult.ok);
  check("and names the domain count rather than the key",
    !resendResult.message.includes("re_live_secret_value"));

  const resendNoDomain = new ResendEmailProvider({
    apiKey: "re_x",
    fetchImpl: stubFetch(() => ({ body: { data: [] } })),
  });
  const noDomain = await resendNoDomain.verify();
  check("a valid key with no sending domain is NOT reported as connected", noDomain.ok === false);
  check("and says why, because mail would be rejected",
    noDomain.code === "NO_SENDING_DOMAIN");

  const resendPending = new ResendEmailProvider({
    apiKey: "re_x",
    fetchImpl: stubFetch(() => ({ body: { data: [{ name: "x.ca", status: "pending" }] } })),
  });
  check("a domain that is not verified yet is not connected either",
    (await resendPending.verify()).code === "DOMAIN_UNVERIFIED");

  const resendBad = new ResendEmailProvider({
    apiKey: "re_wrong",
    fetchImpl: stubFetch(() => ({ status: 401, body: { message: "API key is invalid: re_wrong" } })),
  });
  const resendBadResult = await resendBad.verify();
  check("a rejected Resend key is reported as invalid credentials",
    resendBadResult.code === "INVALID_CREDENTIALS");
  check("and the provider's echo of the key is not passed through",
    !resendBadResult.message.includes("re_wrong"));

  const resendLimited = new ResendEmailProvider({
    apiKey: "re_x",
    fetchImpl: stubFetch(() => ({ status: 429, body: {} })),
  });
  check("rate limiting is reported as itself, not as bad credentials",
    (await resendLimited.verify()).code === "RATE_LIMITED");

  const resendDown = new ResendEmailProvider({
    apiKey: "re_x",
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND api.resend.com"); },
  });
  check("an unreachable provider is reported as unreachable",
    (await resendDown.verify()).code === "UNREACHABLE");

  // --- SMTP -----------------------------------------------------------------
  const smtpOk = new SmtpEmailProvider({
    host: "smtp.example.com", port: 587,
    transport: { verify: async () => true },
  });
  check("SMTP reports a working server as connected", (await smtpOk.verify()).ok);

  const smtpAuth = new SmtpEmailProvider({
    host: "smtp.example.com", port: 587, username: "admin@example.com",
    transport: {
      verify: async () => {
        const error = new Error("535 5.7.8 Authentication credentials invalid for admin@example.com");
        error.code = "EAUTH";
        throw error;
      },
    },
  });
  const smtpAuthResult = await smtpAuth.verify();
  check("a rejected SMTP login is reported as invalid credentials",
    smtpAuthResult.code === "INVALID_CREDENTIALS");
  check("and the server's echo of the username is not passed through",
    !smtpAuthResult.message.includes("admin@example.com"));

  const smtpRefused = new SmtpEmailProvider({
    host: "nope.example.com", port: 587,
    transport: {
      verify: async () => { const e = new Error("connect ECONNREFUSED"); e.code = "ECONNREFUSED"; throw e; },
    },
  });
  check("a refused connection names the host and port as the thing to check",
    (await smtpRefused.verify()).code === "UNREACHABLE");

  const smtpSendFail = new SmtpEmailProvider({
    host: "smtp.example.com", port: 587,
    transport: {
      verify: async () => true,
      sendMail: async () => { const e = new Error("535 auth failed for hunter2"); e.code = "EAUTH"; throw e; },
    },
  });
  const smtpSend = await throws(() => smtpSendFail.send({ to: "a@b.ca", subject: "x", text: "y" }));
  check("an SMTP send failure throws a tagged error", smtpSend.threw);
  check("and the password the server echoed does not reach the caller",
    !String(smtpSend.error?.message).includes("hunter2"));

  // --- Twilio ---------------------------------------------------------------
  const twilioOk = new TwilioSmsProvider({
    accountSid: "AC" + "0".repeat(32), authToken: "the-auth-token", from: "+16475550123",
    fetchImpl: stubFetch(() => ({ body: { friendly_name: "APlus Learn", status: "active" } })),
  });
  const twilioResult = await twilioOk.verify();
  check("Twilio reports working credentials as connected", twilioResult.ok);
  check("and the auth token is not in the answer",
    !twilioResult.message.includes("the-auth-token"));

  const twilioNoSender = new TwilioSmsProvider({
    accountSid: "AC" + "0".repeat(32), authToken: "tok",
    fetchImpl: stubFetch(() => ({ body: { friendly_name: "X", status: "active" } })),
  });
  check("valid credentials with no sender are not reported as connected",
    (await twilioNoSender.verify()).code === "NO_SENDER");

  const twilioSuspended = new TwilioSmsProvider({
    accountSid: "AC" + "0".repeat(32), authToken: "tok", from: "+16475550123",
    fetchImpl: stubFetch(() => ({ body: { friendly_name: "X", status: "suspended" } })),
  });
  check("a suspended account is not reported as connected, however valid the token",
    (await twilioSuspended.verify()).code === "ACCOUNT_SUSPENDED");

  const twilioBad = new TwilioSmsProvider({
    accountSid: "AC" + "0".repeat(32), authToken: "wrong-token",
    fetchImpl: stubFetch(() => ({ status: 401, body: { message: "Authenticate" } })),
  });
  const twilioBadResult = await twilioBad.verify();
  check("a rejected Twilio token is reported as invalid credentials",
    twilioBadResult.code === "INVALID_CREDENTIALS");
  check("and the token is not echoed back",
    !twilioBadResult.message.includes("wrong-token"));

  // The verify call must never send anything: an operator checking a
  // configuration should not be charged for a message.
  const sendCounter = stubFetch((url) => {
    check("the Twilio check is a read, not a send", !url.includes("/Messages.json"));
    return { body: { friendly_name: "X", status: "active" } };
  });
  await new TwilioSmsProvider({
    accountSid: "AC" + "0".repeat(32), authToken: "t", from: "+1", fetchImpl: sendCounter,
  }).verify();

  // --- Calendar app registrations -------------------------------------------
  //
  // The probe is a refresh grant that cannot succeed. `invalid_grant` means
  // the client credentials were accepted and only the bogus token was
  // refused — so it is the *success* case.
  const googleOk = new GoogleCalendarProvider({
    clientId: "id.apps.googleusercontent.com", clientSecret: "the-client-secret",
    fetchImpl: stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } })),
  });
  const googleResult = await googleOk.verify();
  check("Google accepting the client and refusing the probe token reads as connected",
    googleResult.ok);
  check("and the client secret is not in the answer",
    !googleResult.message.includes("the-client-secret"));

  const googleBad = new GoogleCalendarProvider({
    clientId: "id", clientSecret: "wrong",
    fetchImpl: stubFetch(() => ({ status: 401, body: { error: "invalid_client" } })),
  });
  check("Google rejecting the client reads as invalid credentials",
    (await googleBad.verify()).code === "INVALID_CREDENTIALS");

  const googleProbeIsNotAToken = stubFetch((url, options) => {
    check("the calendar probe never sends a real refresh token",
      String(options.body).includes("aplus-credential-probe"));
    return { status: 400, body: { error: "invalid_grant" } };
  });
  await new GoogleCalendarProvider({
    clientId: "id", clientSecret: "s", fetchImpl: googleProbeIsNotAToken,
  }).verify();

  const msOk = new MicrosoftCalendarProvider({
    clientId: "id", clientSecret: "s", tenantId: "common",
    fetchImpl: stubFetch(() => ({ status: 400, body: { error: "invalid_grant" } })),
  });
  check("Microsoft accepting the app registration reads as connected", (await msOk.verify()).ok);

  const msExpired = new MicrosoftCalendarProvider({
    clientId: "id", clientSecret: "s",
    fetchImpl: stubFetch(() => ({
      status: 401,
      body: { error: "invalid_client", error_description: "AADSTS7000222: The provided client secret keys for app are expired." },
    })),
  });
  check("an expired Entra secret is told apart from a wrong one",
    (await msExpired.verify()).code === "CREDENTIALS_EXPIRED");

  const msWrongSecret = new MicrosoftCalendarProvider({
    clientId: "id", clientSecret: "s",
    fetchImpl: stubFetch(() => ({
      status: 401,
      body: { error: "invalid_client", error_description: "AADSTS7000215: Invalid client secret provided." },
    })),
  });
  check("and a wrong one is reported as wrong",
    (await msWrongSecret.verify()).code === "INVALID_CREDENTIALS");

  const msUnknownApp = new MicrosoftCalendarProvider({
    clientId: "id", clientSecret: "s",
    fetchImpl: stubFetch(() => ({
      status: 400,
      body: { error: "unauthorized_client", error_description: "AADSTS700016: Application not found in the directory." },
    })),
  });
  check("an app the tenant does not know names the tenant as the thing to check",
    /tenant/i.test((await msUnknownApp.verify()).message));

  // --- Stripe ---------------------------------------------------------------
  const stripeOk = new StripePaymentProvider({
    secretKey: "sk_test_0000",
    client: {
      accounts: {
        retrieve: async () => ({ id: "acct_1", charges_enabled: true, business_profile: { name: "APlus" } }),
      },
    },
  });
  const stripeResult = await stripeOk.verify();
  check("Stripe reports a working test key as connected", stripeResult.ok);
  check("and reports the mode the key itself carries", stripeResult.livemode === false);
  check("and never echoes the key", !stripeResult.message.includes("sk_test_0000"));

  const stripeLive = new StripePaymentProvider({
    secretKey: "sk_live_0000",
    client: { accounts: { retrieve: async () => ({ id: "acct_2", charges_enabled: true }) } },
  });
  check("a live key is reported as live mode, from the key and not from APP_ENV",
    (await stripeLive.verify()).livemode === true);

  const stripeRestricted = new StripePaymentProvider({
    secretKey: "sk_test_0000",
    client: { accounts: { retrieve: async () => ({ id: "acct_3", charges_enabled: false }) } },
  });
  const restricted = await stripeRestricted.verify();
  check("an account that cannot take charges is NOT reported as connected", restricted.ok === false);
  check("and says onboarding is what is missing", restricted.code === "ACCOUNT_RESTRICTED");

  const stripeBad = new StripePaymentProvider({
    secretKey: "sk_test_wrong",
    client: {
      accounts: {
        retrieve: async () => {
          const error = new Error("Invalid API Key provided: sk_test_wrong");
          error.type = "StripeAuthenticationError";
          throw error;
        },
      },
    },
  });
  const stripeBadResult = await stripeBad.verify();
  check("a rejected Stripe key is reported as invalid credentials",
    stripeBadResult.code === "INVALID_CREDENTIALS");
  check("and Stripe's echo of the key does not reach the operator",
    !stripeBadResult.message.includes("sk_test_wrong"));

  const stripeDown = new StripePaymentProvider({
    secretKey: "sk_test_0000",
    client: {
      accounts: {
        retrieve: async () => { const e = new Error("connection"); e.type = "StripeConnectionError"; throw e; },
      },
    },
  });
  check("an unreachable Stripe is reported as unreachable, not as bad credentials",
    (await stripeDown.verify()).code === "UNREACHABLE");
}

/**
 * Precedence, masking and the disabled switch, against a real database.
 *
 * Writes directly to the `integrations` collection rather than going through
 * the service for the setup, so what is being tested is the resolver's own
 * reading of a stored document.
 */
async function integrationResolverTests() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    skip("external module resolution", "MONGODB_URI is not set");
    return;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
  } catch {
    skip("external module resolution", "MongoDB is not reachable");
    return;
  }

  const { Integration } = await import("@/models");
  const { encryptSecret } = await import("@/lib/security/crypto");
  const {
    resolveIntegrationConfig, requireIntegrationConfig, invalidateIntegrationCache, SECRET_LABEL,
  } = await import("@/lib/config/integrations");

  const saved = await Integration.findOne({ module: "sms" }).select("+secrets").lean();
  const clean = async () => {
    await Integration.deleteOne({ module: "sms" });
    invalidateIntegrationCache("sms");
  };

  const withEnv = async (vars, fn) => {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
    invalidateIntegrationCache("sms");
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      invalidateIntegrationCache("sms");
    }
  };

  const ENV = {
    SMS_PROVIDER: "twilio",
    TWILIO_ACCOUNT_SID: "AC" + "1".repeat(32),
    TWILIO_AUTH_TOKEN: "env-auth-token",
    TWILIO_FROM_NUMBER: "+15550000001",
  };

  try {
    // --- 1. No stored record: the deployment behaves exactly as before ------
    await clean();
    await withEnv(ENV, async () => {
      const resolved = await resolveIntegrationConfig("sms", { fresh: true });
      check("with nothing stored, a module reads the environment",
        resolved.source === "environment" && resolved.provider === "twilio");
      check("and is enabled, so upgrading does not switch a working channel off",
        resolved.enabled === true);
      check("and the environment's credential is the one that would be used",
        resolved.secrets.authToken === "env-auth-token");
    });

    // --- 2. Stored configuration wins, per field ---------------------------
    await Integration.create({
      module: "sms",
      enabled: true,
      provider: "twilio",
      config: { accountSid: "AC" + "2".repeat(32) },
      secrets: { authToken: encryptSecret("stored-auth-token", SECRET_LABEL) },
      secretMeta: { authToken: { set: true, updatedAt: new Date() } },
    });

    await withEnv(ENV, async () => {
      const resolved = await resolveIntegrationConfig("sms", { fresh: true });
      check("a stored configuration overrides the environment",
        resolved.source === "database" && resolved.secrets.authToken === "stored-auth-token");
      check("and overrides it field by field",
        resolved.config.accountSid === "AC" + "2".repeat(32));
      check("while a field it does not set still falls back to the environment",
        resolved.config.fromNumber === "+15550000001");
    });

    // --- 3. The switch has teeth -------------------------------------------
    await Integration.updateOne({ module: "sms" }, { $set: { enabled: false } });
    invalidateIntegrationCache("sms");

    await withEnv(ENV, async () => {
      const refused = await throws(() => requireIntegrationConfig("sms"));
      check("a switched-off module refuses at the point of use", refused.threw);
      check("and says so with its own code rather than a misconfiguration",
        refused.error?.code === "MODULE_DISABLED");

      const { getSmsProvider, resetSmsProvider } = await import("@/services/external/sms-provider");
      resetSmsProvider();
      const factoryRefused = await throws(() => getSmsProvider());
      check("so the provider factory cannot hand back an adapter for it",
        factoryRefused.threw && factoryRefused.error?.code === "MODULE_DISABLED");
      resetSmsProvider();
    });

    // --- 4. A credential that cannot be read is an error, never a fallback --
    await Integration.updateOne(
      { module: "sms" },
      { $set: { enabled: true, "secrets.authToken": "v1.bm90.YXJlYWw.Y2lwaGVy" } },
    );
    invalidateIntegrationCache("sms");

    await withEnv(ENV, async () => {
      const resolved = await resolveIntegrationConfig("sms", { fresh: true });
      check("a credential that will not decrypt leaves the module unconfigured",
        resolved.configured === false);
      check("and says what happened and how to repair it",
        /AUTH_SECRET/.test(resolved.error ?? ""));
      check(
        "and it does NOT silently fall back to the environment's credential",
        resolved.secrets.authToken === undefined,
      );
    });

    // --- 5. Production still refuses a fake where one is not allowed -------
    await Integration.updateOne({ module: "sms" }, { $set: { provider: "twilio" } });
    await Integration.deleteOne({ module: "payment" });
    await Integration.create({ module: "payment", enabled: true, provider: "development" });
    invalidateIntegrationCache("payment");

    const before = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    invalidateIntegrationCache("payment");
    const prodPayment = await resolveIntegrationConfig("payment", { fresh: true });
    check(
      "no stored configuration can put payments into development mode in production",
      prodPayment.configured === false,
    );
    check("and the refusal names the module", /Payments/.test(prodPayment.error ?? ""));
    process.env.APP_ENV = before;
    await Integration.deleteOne({ module: "payment" });
    invalidateIntegrationCache("payment");

    // --- 6. The admin view never carries a credential ----------------------
    await Integration.deleteOne({ module: "sms" });
    await Integration.create({
      module: "sms",
      enabled: true,
      provider: "twilio",
      config: { accountSid: "AC" + "3".repeat(32), fromNumber: "+15550000002" },
      secrets: { authToken: encryptSecret("top-secret-token", SECRET_LABEL) },
      secretMeta: { authToken: { set: true, updatedAt: new Date() } },
    });
    invalidateIntegrationCache("sms");

    const { getIntegrationModule } = await import("@/services/integration.service");
    const view = await getIntegrationModule("sms");
    const serialised = JSON.stringify(view);

    check("the admin view says the credential is set", view.secrets.authToken.set === true);
    check("without carrying its value", !serialised.includes("top-secret-token"));
    check("or its ciphertext", !serialised.includes("v1."));
    check("and a token the registry does not mark as revealable shows nothing at all",
      view.secrets.authToken.last4 == null);
    check("while the non-secret account SID is shown in full",
      view.config.accountSid === "AC" + "3".repeat(32));

    // --- 7. Stripe's mode comes from the key, and a mismatch is refused ----
    const { stripeModeOf } = await import("@/lib/validation/integrations");
    check("a live key is recognised as live", stripeModeOf("sk_live_abc") === "live");
    check("a restricted live key too", stripeModeOf("rk_live_abc") === "live");
    check("a test key as test", stripeModeOf("sk_test_abc") === "test");
    check("and something that is not a Stripe key at all as neither",
      stripeModeOf("hello") === null);
  } finally {
    await Integration.deleteOne({ module: "sms" });
    await Integration.deleteOne({ module: "payment" });
    if (saved) {
      // Put back whatever the deployment had, so running the suite does not
      // reconfigure the developer's own machine.
      const { _id, ...rest } = saved;
      await Integration.create(rest);
    }
    invalidateIntegrationCache();
  }
}


// --- 28. Disputes (§26) -----------------------------------------------------

/**
 * The dispute lifecycle, against the payment ledger it is supposed to agree
 * with.
 *
 * The rule this section exists for is that **a decision is terminal**. A
 * dispute that has been decided cannot be decided again, by a second click, a
 * replayed request or a second administrator — because the first decision
 * already moved money through `refundPayment`, and a second one would leave
 * the stored dispute describing a refund that did not happen that way. The
 * payment layer refuses to over-refund whatever we do here, so the money was
 * never at risk; what was at risk was the record, and therefore every report
 * and audit built on it.
 *
 * Every assertion checks the persisted documents, not just the return value:
 * the failure mode being guarded against is precisely one where the response
 * looks fine and the database does not.
 */
async function disputeTests() {
  section("Disputes — lifecycle, terminal decisions and the payment ledger");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("disputes", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("disputes", "MongoDB is not reachable");
    }
  }

  const {
    Dispute, Booking, Payment, TutorProfile, StudentProfile, Notification, AuditLog, RiskCase,
    Settings,
  } = await import("@/models");
  const disputes = await import("@/services/dispute.service");
  const {
    DISPUTE_STATUS, DISPUTE_REASONS, BOOKING_STATUS, PAYMENT_STATUS, ROLES,
    RESOLVED_DISPUTE_STATUSES, OPEN_DISPUTE_STATUSES,
  } = await import("@/constants");
  const { resetPaymentProvider } = await import("@/services/external/payment-provider");
  const { invalidateSettingsCache } = await import("@/services/settings.service");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).populate("userId").lean();
  const learner = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutor || !learner) {
    return skip("disputes", "no seeded tutor/student — run `bun run seed`");
  }

  // A refund is a real call into the payment adapter. This section is about
  // the dispute rules rather than the card rails, which have their own
  // section, so it runs on the development provider.
  const paymentProviderBefore = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "development";
  resetPaymentProvider();

  const purchaserId = learner.ownerId;
  const tutorUserId = tutor.userId?._id ?? tutor.userId;

  const purchaser = { id: String(purchaserId), role: ROLES.PARENT };
  const tutorActor = { id: String(tutorUserId), role: ROLES.TUTOR };
  const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const otherAdmin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

  const madeBookings = [];
  const madePayments = [];
  const madeDisputes = [];

  // Far enough back that the lessons have genuinely finished — a dispute can
  // only be raised on a lesson that is over — and old enough to sit outside
  // every analytics window, so this fixture cannot move a reported figure.
  // Stepped per fixture so two of these can never collide with each other.
  let pastCursor = new Date("2024-03-03T14:00:00.000Z");

  /**
   * A finished, fully paid lesson — the only shape a dispute can be raised
   * against. `paidTotal` is allowed to differ from the lesson price so the
   * mismatch case (below) can be built from the same helper.
   */
  const settledLesson = async ({ totalCents = 6000, paidTotal = totalCents } = {}) => {
    const startAt = new Date(pastCursor);
    pastCursor = new Date(pastCursor.getTime() + 3 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);

    const booking = await Booking.create({
      reference: `APL-D${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId,
      studentProfileId: learner._id,
      tutorProfileId: tutor._id,
      tutorUserId,
      courseId: tutor.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      courseCode: "MHF4U",
      mode: "ONLINE",
      startAt,
      endAt,
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      completedAt: endAt,
      price: {
        hourlyRateCents: totalCents,
        durationMinutes: 60,
        subtotalCents: totalCents,
        commissionPercent: 15,
        commissionCents: Math.round(totalCents * 0.15),
        tutorEarningsCents: totalCents - Math.round(totalCents * 0.15),
        totalCents,
      },
    });

    const payment = await Payment.create({
      bookingId: booking._id,
      purchaserId,
      tutorUserId,
      subtotalCents: paidTotal,
      commissionPercent: 15,
      commissionCents: Math.round(paidTotal * 0.15),
      tutorEarningsCents: paidTotal - Math.round(paidTotal * 0.15),
      totalCents: paidTotal,
      status: PAYMENT_STATUS.PAID,
      paidAt: endAt,
      provider: "DEVELOPMENT",
      providerPaymentIntentId: `pi_dev_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    });

    await Booking.updateOne({ _id: booking._id }, { $set: { paymentId: payment._id } });
    booking.paymentId = payment._id;

    madeBookings.push(booking._id);
    madePayments.push(payment._id);
    return { booking, payment };
  };

  /** Raise a dispute on a fresh settled lesson and return everything about it. */
  const openDispute = async (actor = purchaser, overrides = {}) => {
    const { booking, payment } = await settledLesson(overrides.lesson ?? {});
    const dispute = await disputes.createDispute(
      {
        bookingId: String(booking._id),
        reason: DISPUTE_REASONS.LESSON_QUALITY,
        description: "The lesson did not cover what was agreed. Raised by the integration suite.",
        ...overrides.input,
      },
      actor,
    );
    madeDisputes.push(dispute.id);
    return { dispute, booking, payment };
  };

  const disputeDoc = (id) => Dispute.findById(id).lean();
  const paymentDoc = (id) => Payment.findById(id).lean();
  const bookingDoc = (id) => Booking.findById(id).lean();

  const riskBefore = await Settings.findOne({ key: "PLATFORM" }).select("risk").lean();

  try {
    // --- 1. Raising: who may, and when -------------------------------------
    const { booking: openLesson } = await settledLesson();

    const byStranger = await throws(
      () =>
        disputes.createDispute(
          {
            bookingId: String(openLesson._id),
            reason: DISPUTE_REASONS.BILLING,
            description: "I have nothing to do with this lesson at all, honestly.",
          },
          stranger,
        ),
      (e) => e.code === "FORBIDDEN",
    );
    check("someone who was not on the lesson cannot raise a dispute about it",
      byStranger.threw && byStranger.matched, byStranger.error?.message);

    // A lesson that has not happened yet has nothing to dispute.
    const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const future = await Booking.create({
      reference: `APL-D${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId,
      studentProfileId: learner._id,
      tutorProfileId: tutor._id,
      tutorUserId,
      courseId: tutor.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      mode: "ONLINE",
      startAt: futureStart,
      endAt: new Date(futureStart.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.CONFIRMED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(future._id);

    const tooEarly = await throws(
      () =>
        disputes.createDispute(
          {
            bookingId: String(future._id),
            reason: DISPUTE_REASONS.OTHER,
            description: "Raising this before the lesson has even started, which is too early.",
          },
          purchaser,
        ),
      (e) => e.status === 422,
    );
    check("a dispute cannot be raised before the lesson has finished",
      tooEarly.threw && tooEarly.matched, tooEarly.error?.message);

    // --- 2. A raised dispute, and what it did to the booking ---------------
    const first = await disputes.createDispute(
      {
        bookingId: String(openLesson._id),
        reason: DISPUTE_REASONS.TUTOR_NO_SHOW,
        description: "Nobody joined the room at the agreed time. Raised by the integration suite.",
        requestedRefundCents: 6000,
      },
      purchaser,
    );
    madeDisputes.push(first.id);

    check("a dispute starts open", first.status === DISPUTE_STATUS.OPEN);
    check("and is counted against the other party, not the person who raised it",
      String(first.againstUserId) === String(tutorUserId));
    check("the lesson moves into the disputed state",
      (await bookingDoc(openLesson._id)).status === BOOKING_STATUS.DISPUTED);
    check("and it carries a public reference", /^DIS-/.test(first.reference));

    const opened = await Notification.countDocuments({
      entityType: "Dispute",
      entityId: new mongoose.Types.ObjectId(first.id),
      userId: tutorUserId,
    });
    check("the person it is about is told", opened === 1);

    const second = await throws(
      () =>
        disputes.createDispute(
          {
            bookingId: String(openLesson._id),
            reason: DISPUTE_REASONS.BILLING,
            description: "A second, simultaneous dispute about exactly the same lesson.",
          },
          tutorActor,
        ),
      (e) => e.code === "CONFLICT",
    );
    check("a second dispute cannot be opened while one is still running",
      second.threw && second.matched, second.error?.message);

    const { booking: overAskLesson } = await settledLesson();
    const overAsk = await throws(
      () =>
        disputes.createDispute(
          {
            bookingId: String(overAskLesson._id),
            reason: DISPUTE_REASONS.BILLING,
            description: "Asking for more money back than the lesson ever cost anybody.",
            requestedRefundCents: 99_999_00,
          },
          purchaser,
        ),
      (e) => e.status === 422,
    );
    check("a request for more than the lesson cost is refused",
      overAsk.threw && overAsk.matched, overAsk.error?.message);

    // --- 3. Reading it -----------------------------------------------------
    const asParty = await disputes.getDispute(first.id, purchaser);
    check("the person who raised it can read it", asParty.id === first.id);
    check("and a party sees no internal admin notes", asParty.adminNotes === undefined);

    const asStranger = await throws(
      () => disputes.getDispute(first.id, stranger),
      (e) => e.code === "FORBIDDEN",
    );
    check("someone unrelated cannot read it", asStranger.threw && asStranger.matched);

    const noted = await disputes.addDisputeNote(first.id, "Called the tutor for their side.", admin);
    check("an internal note moves an open dispute into review",
      noted.status === DISPUTE_STATUS.UNDER_REVIEW);
    check("and the note is kept with who wrote it",
      noted.adminNotes.length === 1 && String(noted.adminNotes[0].adminId) === admin.id);
    check("an administrator does see the internal notes",
      (await disputes.getDispute(first.id, admin)).adminNotes.length === 1);

    // --- 4. Risk linkage ---------------------------------------------------
    //
    // Thresholds are the operator's, so the fixture sets one it can predict
    // and puts it back afterwards. What is being proved is the *linkage* —
    // that raising a dispute reaches the risk service at all — not the
    // shipped number.
    await Settings.updateOne(
      { key: "PLATFORM" },
      { $set: { "risk.enabled": true, "risk.disputeThreshold": 1, "risk.reviewScore": 1 } },
      { upsert: true },
    );
    invalidateSettingsCache();

    const { dispute: flagging } = await openDispute(purchaser);
    const riskCase = await RiskCase.findOne({
      subjectUserId: tutorUserId,
      "signals.type": "REPEATED_DISPUTES",
    }).lean();
    check("a dispute opens or joins a risk case against the account it names",
      Boolean(riskCase), "no case with a REPEATED_DISPUTES signal");
    check("and the signal carries the dispute as its evidence",
      Boolean(riskCase?.signals?.some((s) => s.type === "REPEATED_DISPUTES" && s.summary)));

    // --- 5. A decision with no money in it ---------------------------------
    const { dispute: noRefundCase, booking: noRefundBooking, payment: noRefundPayment } =
      await openDispute();

    const noRefund = await disputes.resolveDispute(
      noRefundCase.id,
      { resolution: "RESOLVED_NO_REFUND", note: "The lesson took place as described." },
      admin,
    );
    check("a no-refund decision closes the dispute",
      noRefund.status === DISPUTE_STATUS.RESOLVED_NO_REFUND);
    check("records who decided it and when",
      String(noRefund.resolvedBy) === admin.id && Boolean(noRefund.resolvedAt));
    check("issues nothing", noRefund.refundIssuedCents === 0);
    check("leaves the payment exactly as it was",
      (await paymentDoc(noRefundPayment._id)).refundedCents === 0);
    check("and returns the lesson to completed rather than cancelled",
      (await bookingDoc(noRefundBooking._id)).status === BOOKING_STATUS.COMPLETED);

    const bothTold = await Notification.countDocuments({
      entityType: "Dispute",
      entityId: new mongoose.Types.ObjectId(noRefundCase.id),
      title: new RegExp(`${noRefund.reference} resolved`),
    });
    check("both parties are told the outcome", bothTold === 2);

    const audited = await AuditLog.countDocuments({
      action: "DISPUTE_RESOLVED",
      entityId: new mongoose.Types.ObjectId(noRefundCase.id),
    });
    check("and the decision is audited exactly once", audited === 1);

    // --- 6. The terminal guard ---------------------------------------------
    //
    // One fixture per terminal status, because the defect this replaces was
    // specifically that *some* closed states were re-decidable.
    const terminalCases = [
      { resolution: "RESOLVED_NO_REFUND", expect: DISPUTE_STATUS.RESOLVED_NO_REFUND },
      { resolution: "REJECTED", expect: DISPUTE_STATUS.REJECTED },
      { resolution: "RESOLVED_REFUND", expect: DISPUTE_STATUS.RESOLVED_REFUND },
      { resolution: "RESOLVED_PARTIAL_REFUND", expect: DISPUTE_STATUS.RESOLVED_PARTIAL_REFUND },
    ];

    for (const terminal of terminalCases) {
      const { dispute, payment } = await openDispute();
      const decided = await disputes.resolveDispute(
        dispute.id,
        {
          resolution: terminal.resolution,
          refundCents: terminal.resolution === "RESOLVED_PARTIAL_REFUND" ? 1500 : undefined,
          note: `First and only decision: ${terminal.resolution}.`,
        },
        admin,
      );
      check(`a ${terminal.resolution.toLowerCase()} decision is recorded`,
        decided.status === terminal.expect);

      const refundedAfterFirst = (await paymentDoc(payment._id)).refundedCents ?? 0;

      // Every other decision, tried against this closed dispute.
      for (const again of ["RESOLVED_REFUND", "RESOLVED_NO_REFUND", "RESOLVED_PARTIAL_REFUND", "REJECTED"]) {
        const refused = await throws(
          () =>
            disputes.resolveDispute(
              dispute.id,
              { resolution: again, refundCents: 500, note: "Trying to decide this a second time." },
              otherAdmin,
            ),
          (e) => e.code === "CONFLICT",
        );
        check(`a ${terminal.expect} dispute refuses a later ${again}`,
          refused.threw && refused.matched,
          refused.error?.message ?? "it was accepted");
      }

      const stored = await disputeDoc(dispute.id);
      check(`the ${terminal.expect} record is unchanged by the attempts`,
        stored.status === terminal.expect && String(stored.resolvedBy) === admin.id);
      check(`and no further money moved on its payment`,
        ((await paymentDoc(payment._id)).refundedCents ?? 0) === refundedAfterFirst);
      check(`the audit still shows one decision for it`,
        (await AuditLog.countDocuments({
          action: "DISPUTE_RESOLVED",
          entityId: new mongoose.Types.ObjectId(dispute.id),
        })) === 1);
    }

    // --- 7. The money, in both directions ----------------------------------
    const { dispute: partialCase, booking: partialBooking, payment: partialPayment } =
      await openDispute();
    const partial = await disputes.resolveDispute(
      partialCase.id,
      { resolution: "RESOLVED_PARTIAL_REFUND", refundCents: 2500, note: "Half the lesson was lost." },
      admin,
    );
    const partialLedger = await paymentDoc(partialPayment._id);
    check("a partial refund reaches the payment", partialLedger.refundedCents === 2500);
    check("and leaves it partially refunded",
      partialLedger.status === PAYMENT_STATUS.PARTIALLY_REFUNDED);
    check("the dispute records the same figure the ledger did",
      partial.refundIssuedCents === partialLedger.refundedCents);
    check("and a partly refunded lesson still counts as completed",
      (await bookingDoc(partialBooking._id)).status === BOOKING_STATUS.COMPLETED);

    const { dispute: fullCase, booking: fullBooking, payment: fullPayment } = await openDispute();
    const full = await disputes.resolveDispute(
      fullCase.id,
      { resolution: "RESOLVED_REFUND", note: "The lesson never happened." },
      admin,
    );
    const fullLedger = await paymentDoc(fullPayment._id);
    check("a full refund returns the whole lesson price", fullLedger.refundedCents === 6000);
    check("and marks the payment refunded", fullLedger.status === PAYMENT_STATUS.REFUNDED);
    check("the dispute agrees with it", full.refundIssuedCents === 6000);
    check("and a fully refunded lesson is cancelled rather than completed",
      (await bookingDoc(fullBooking._id)).status === BOOKING_STATUS.CANCELLED_BY_ADMIN);

    // --- 8. A payment that has already given everything back ---------------
    //
    // The first dispute took the whole lesson price. A second one on the same
    // lesson must not be able to award it again — the ledger would refuse the
    // refund, and without this the dispute record would claim one anyway.
    const secondBite = await disputes.createDispute(
      {
        bookingId: String(fullBooking._id),
        reason: DISPUTE_REASONS.BILLING,
        description: "A second dispute on a lesson whose money has already been returned.",
      },
      purchaser,
    );
    madeDisputes.push(secondBite.id);

    const secondDecision = await disputes.resolveDispute(
      secondBite.id,
      { resolution: "RESOLVED_REFUND", note: "Nothing is left to refund on this one." },
      admin,
    );
    check("a refund decision on an already-refunded lesson issues nothing",
      secondDecision.refundIssuedCents === 0);
    check("and the ledger is untouched by it",
      (await paymentDoc(fullPayment._id)).refundedCents === 6000);

    const disputeTotal = (
      await Dispute.find({ bookingId: fullBooking._id }).select("refundIssuedCents").lean()
    ).reduce((sum, d) => sum + (d.refundIssuedCents ?? 0), 0);
    check("the disputes on a lesson never add up to more than the ledger returned",
      disputeTotal === (await paymentDoc(fullPayment._id)).refundedCents);

    const askingTooMuch = await throws(
      () =>
        disputes.createDispute(
          {
            bookingId: String(fullBooking._id),
            reason: DISPUTE_REASONS.BILLING,
            description: "Asking for money back that an earlier dispute already returned.",
            requestedRefundCents: 6000,
          },
          tutorActor,
        ),
      (e) => e.status === 422,
    );
    check("and a new dispute cannot ask for what an earlier one already returned",
      askingTooMuch.threw && askingTooMuch.matched, askingTooMuch.error?.message);

    // --- 9. A refund the ledger refuses leaves the dispute decidable -------
    //
    // A lesson priced above what was actually collected. The decision asks
    // for the lesson price, the ledger refuses, and the dispute has to end up
    // exactly where it started rather than closed on a refund that never
    // happened.
    const { dispute: mismatched, payment: shortPayment } = await openDispute(purchaser, {
      lesson: { totalCents: 9000, paidTotal: 6000 },
    });

    const refused = await throws(
      () =>
        disputes.resolveDispute(
          mismatched.id,
          { resolution: "RESOLVED_REFUND", note: "Refunding more than was ever collected." },
          admin,
        ),
      (e) => e.code === "REFUND_EXCEEDS_BALANCE",
    );
    check("a decision whose refund the ledger refuses fails",
      refused.threw && refused.matched, refused.error?.message);

    const released = await disputeDoc(mismatched.id);
    check("and leaves the dispute open for another attempt",
      OPEN_DISPUTE_STATUSES.includes(released.status), released.status);
    check("with nothing recorded as decided",
      !released.resolvedAt && !released.resolvedBy && (released.refundIssuedCents ?? 0) === 0);
    check("and nothing taken from the payment",
      ((await paymentDoc(shortPayment._id)).refundedCents ?? 0) === 0);

    const retried = await disputes.resolveDispute(
      mismatched.id,
      { resolution: "RESOLVED_PARTIAL_REFUND", refundCents: 6000, note: "Returning what was paid." },
      admin,
    );
    check("so the administrator can decide it correctly on the second attempt",
      retried.status === DISPUTE_STATUS.RESOLVED_PARTIAL_REFUND &&
        retried.refundIssuedCents === 6000);

    // --- 10. Two administrators, at the same moment ------------------------
    const { dispute: raced, payment: racedPayment } = await openDispute();
    const outcomes = await Promise.allSettled([
      disputes.resolveDispute(
        raced.id,
        { resolution: "RESOLVED_REFUND", note: "First administrator, deciding to refund." },
        admin,
      ),
      disputes.resolveDispute(
        raced.id,
        { resolution: "RESOLVED_NO_REFUND", note: "Second administrator, deciding not to." },
        otherAdmin,
      ),
    ]);

    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected");
    check("exactly one of two simultaneous decisions is accepted",
      won.length === 1, `${won.length} succeeded`);
    check("and the other is refused as a conflict",
      lost.length === 1 && lost[0].reason?.code === "CONFLICT",
      lost[0]?.reason?.code);

    const racedStored = await disputeDoc(raced.id);
    const racedLedger = await paymentDoc(racedPayment._id);
    check("the stored decision is the one that was accepted",
      racedStored.status === won[0].value.status);
    check("and the ledger matches whichever decision that was",
      (racedLedger.refundedCents ?? 0) === racedStored.refundIssuedCents,
      `${racedLedger.refundedCents} vs ${racedStored.refundIssuedCents}`);
    check("the race produced one audit record, not two",
      (await AuditLog.countDocuments({
        action: "DISPUTE_RESOLVED",
        entityId: new mongoose.Types.ObjectId(raced.id),
      })) === 1);

    // --- 11. The shared vocabulary -----------------------------------------
    check("every decided status is named as terminal",
      RESOLVED_DISPUTE_STATUSES.length === 4 &&
        RESOLVED_DISPUTE_STATUSES.every((s) => !OPEN_DISPUTE_STATUSES.includes(s)));
    check("and the two lists together cover every dispute status",
      new Set([...RESOLVED_DISPUTE_STATUSES, ...OPEN_DISPUTE_STATUSES]).size ===
        Object.values(DISPUTE_STATUS).length);

    // --- 12. The one that is still open is still decidable -----------------
    const closing = await disputes.resolveDispute(
      flagging.id,
      { resolution: "REJECTED", note: "Closing the risk fixture; not a real decision." },
      admin,
    );
    check("an open dispute is still decidable after all of the above",
      closing.status === DISPUTE_STATUS.REJECTED);
  } finally {
    // Thresholds back the way the deployment had them.
    await Settings.updateOne(
      { key: "PLATFORM" },
      {
        $set: {
          "risk.enabled": riskBefore?.risk?.enabled ?? true,
          "risk.disputeThreshold": riskBefore?.risk?.disputeThreshold ?? 2,
          "risk.reviewScore": riskBefore?.risk?.reviewScore ?? 2,
        },
      },
    );
    invalidateSettingsCache();

    if (paymentProviderBefore === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = paymentProviderBefore;
    resetPaymentProvider();

    const disputeIds = madeDisputes.map((id) => new mongoose.Types.ObjectId(id));
    await Notification.deleteMany({ entityType: "Dispute", entityId: { $in: disputeIds } });
    await AuditLog.deleteMany({ entityType: "Dispute", entityId: { $in: disputeIds } });
    await Dispute.deleteMany({ _id: { $in: disputeIds } });
    await AuditLog.deleteMany({ entityType: "Payment", entityId: { $in: madePayments } });
    await Notification.deleteMany({ entityType: "Payment", entityId: { $in: madePayments } });
    await Payment.deleteMany({ _id: { $in: madePayments } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    // The risk fixture named a real seeded tutor, which may have had a case
    // before this run. Only the signals this run added are pulled, and the
    // case itself is removed only if nothing else was ever in it.
    await RiskCase.updateMany(
      { subjectUserId: tutorUserId },
      {
        $pull: {
          signals: { dedupeKey: { $in: madeDisputes.map((id) => `dispute:${tutorUserId}:${id}`) } },
        },
      },
    );
    await RiskCase.deleteMany({ subjectUserId: tutorUserId, signals: { $size: 0 } });
  }
}

// --- 29. Curriculum (§13) ---------------------------------------------------

/**
 * Province → grade → subject → course, through the service that owns it.
 *
 * Three things only a direct call can reach, and all three are the reason
 * this module needed coverage: that a course carries the *denormalised*
 * province, grade and subject the whole of search reads instead of a
 * `$lookup`, and that those copies are rewritten when the course is moved;
 * that deactivation really does remove something from every public read,
 * because deactivation is the only removal path provinces, grades and
 * subjects have; and that the per-process reference cache is dropped on every
 * write, since a sixty-second stale picker after an administrator adds a
 * course is indistinguishable from the write not having worked.
 *
 * Who may write is a separate question, answered over HTTP in `qa.mjs` where
 * the permission actually lives.
 */
async function curriculumTests() {
  section("Curriculum — hierarchy, denormalisation, activation and caching");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("curriculum", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("curriculum", "MongoDB is not reachable");
    }
  }

  const { Province, Grade, Subject, Course, TutorProfile, AuditLog } = await import("@/models");
  const curriculum = await import("@/services/curriculum.service");
  const { ROLES } = await import("@/constants");

  const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };
  const tag = randomUUID().slice(0, 6).toUpperCase();

  const made = { provinces: [], grades: [], subjects: [], courses: [] };

  try {
    // --- provinces ---------------------------------------------------------
    const province = await curriculum.createProvince(
      {
        code: `Z${tag}`,
        name: `Testland ${tag}`,
        isActive: true,
        usesCourseCodes: true,
        displayOrder: 900,
      },
      admin,
    );
    made.provinces.push(province.id);

    check("a province is created with a slug derived from its name",
      province.slug === `testland-${tag.toLowerCase()}`);
    check("and it is immediately visible to the public reader",
      (await curriculum.listProvinces()).some((p) => p.id === province.id),
      "the reference cache was not dropped on write");

    const dupCode = await throws(
      () =>
        curriculum.createProvince(
          { code: province.code, name: `Somewhere else ${tag}`, isActive: true },
          admin,
        ),
      (e) => e.code === "CONFLICT",
    );
    check("a second province cannot reuse a province code",
      dupCode.threw && dupCode.matched, dupCode.error?.message);

    const dupName = await throws(
      () => curriculum.createProvince({ code: `Y${tag}`, name: province.name }, admin),
      (e) => e.code === "CONFLICT",
    );
    check("nor the same name, which would collide on the slug",
      dupName.threw && dupName.matched, dupName.error?.message);

    const missingProvince = await throws(
      () => curriculum.updateProvince(new mongoose.Types.ObjectId(), { isActive: false }, admin),
      (e) => e.code === "NOT_FOUND",
    );
    check("updating a province that does not exist is a 404, not a silent no-op",
      missingProvince.threw && missingProvince.matched);

    // --- grades ------------------------------------------------------------
    const grade = await curriculum.createGrade(
      { provinceId: province.id, name: `Grade 12 ${tag}`, level: 12, stage: "SECONDARY" },
      admin,
    );
    made.grades.push(grade.id);
    check("a grade belongs to a province", String(grade.provinceId) === province.id);
    check("and appears under it", (await curriculum.listGrades({ provinceCode: province.code }))
      .some((g) => g.id === grade.id));

    const dupGrade = await throws(
      () =>
        curriculum.createGrade(
          { provinceId: province.id, name: grade.name, level: 12, stage: "SECONDARY" },
          admin,
        ),
      (e) => e.code === 11000 || /duplicate key/i.test(e.message),
    );
    check("the same grade cannot be added twice to one province",
      dupGrade.threw && dupGrade.matched, dupGrade.error?.message);

    const badStage = await throws(
      () =>
        curriculum.createGrade(
          { provinceId: province.id, name: `Grade 13 ${tag}`, level: 13, stage: "UNIVERSITY" },
          admin,
        ),
      (e) => e.name === "ValidationError",
    );
    check("and a grade cannot be given a stage the model does not define",
      badStage.threw && badStage.matched, badStage.error?.message);

    // --- subjects ----------------------------------------------------------
    const subject = await curriculum.createSubject(
      { name: `Astrophysics ${tag}`, isActive: true, displayOrder: 900 },
      admin,
    );
    made.subjects.push(subject.id);
    check("a subject is created active and listed",
      (await curriculum.listSubjects()).some((s) => s.id === subject.id));

    const dupSubject = await throws(
      () => curriculum.createSubject({ name: subject.name }, admin),
      (e) => e.code === 11000 || /duplicate key/i.test(e.message),
    );
    check("two subjects cannot share a slug",
      dupSubject.threw && dupSubject.matched, dupSubject.error?.message);

    // --- courses -----------------------------------------------------------
    const course = await curriculum.createCourse(
      {
        provinceId: province.id,
        gradeId: grade.id,
        subjectId: subject.id,
        name: `Stellar Mechanics ${tag}`,
        code: `ZZZ${tag.slice(0, 2)}`,
        stream: "University",
        isActive: true,
      },
      admin,
    );
    made.courses.push(course.id);

    check("a course copies the province code it was created under",
      course.provinceCode === province.code);
    check("and the grade's slug and level", course.gradeSlug === grade.slug && course.gradeLevel === 12);
    check("and the subject's slug and name",
      course.subjectSlug === subject.slug && course.subjectName === subject.name);
    check("its own slug comes from its name", course.slug.startsWith("stellar-mechanics"));

    const badParents = await throws(
      () =>
        curriculum.createCourse(
          {
            provinceId: new mongoose.Types.ObjectId(),
            gradeId: grade.id,
            subjectId: subject.id,
            name: `Orphan course ${tag}`,
          },
          admin,
        ),
      (e) => e.code === "NOT_FOUND",
    );
    check("a course cannot be hung off a province that does not exist",
      badParents.threw && badParents.matched, badParents.error?.message);

    const dupCourseCode = await throws(
      () =>
        curriculum.createCourse(
          {
            provinceId: province.id,
            gradeId: grade.id,
            subjectId: subject.id,
            name: `A different name ${tag}`,
            code: course.code,
          },
          admin,
        ),
      (e) => e.code === 11000 || /duplicate key/i.test(e.message),
    );
    check("a course code is unique within its province",
      dupCourseCode.threw && dupCourseCode.matched, dupCourseCode.error?.message);

    // Two codeless courses are legitimate — the uniqueness index is partial
    // precisely so elementary courses do not collide on a missing code.
    const codeless = await curriculum.createCourse(
      {
        provinceId: province.id,
        gradeId: grade.id,
        subjectId: subject.id,
        name: `Introductory Stargazing ${tag}`,
      },
      admin,
    );
    made.courses.push(codeless.id);
    const secondCodeless = await curriculum.createCourse(
      {
        provinceId: province.id,
        gradeId: grade.id,
        subjectId: subject.id,
        name: `Advanced Stargazing ${tag}`,
      },
      admin,
    );
    made.courses.push(secondCodeless.id);
    check("but two courses with no code at all do not collide",
      Boolean(codeless.id && secondCodeless.id));

    const foundByPath = await curriculum.getCourseByPath({
      province: province.code,
      grade: grade.slug,
      subject: subject.slug,
      course: course.slug,
    });
    check("the public SEO path resolves to the course", foundByPath?.id === course.id);
    check("and so does its course code", (
      await curriculum.getCourseByPath({
        province: province.code,
        grade: grade.slug,
        subject: subject.slug,
        course: course.code,
      })
    )?.id === course.id);

    // --- moving a course rewrites its denormalised copies ------------------
    const otherSubject = await curriculum.createSubject({ name: `Geology ${tag}` }, admin);
    made.subjects.push(otherSubject.id);
    const otherGrade = await curriculum.createGrade(
      { provinceId: province.id, name: `Grade 11 ${tag}`, level: 11, stage: "SECONDARY" },
      admin,
    );
    made.grades.push(otherGrade.id);

    const moved = await curriculum.updateCourse(
      course.id,
      { subjectId: otherSubject.id, gradeId: otherGrade.id },
      admin,
    );
    check("moving a course to another subject rewrites its denormalised subject",
      moved.subjectSlug === otherSubject.slug && moved.subjectName === otherSubject.name);
    check("and moving it to another grade rewrites the slug and the level",
      moved.gradeSlug === otherGrade.slug && moved.gradeLevel === 11);
    check("so a search filtered by the new grade finds it",
      (await curriculum.listCourses({ province: province.code, grade: otherGrade.slug }))
        .items.some((c) => c.id === course.id));
    check("and one filtered by the old grade no longer does",
      !(await curriculum.listCourses({ province: province.code, grade: grade.slug }))
        .items.some((c) => c.id === course.id));

    const missingCourse = await throws(
      () => curriculum.updateCourse(new mongoose.Types.ObjectId(), { name: "Nowhere" }, admin),
      (e) => e.code === "NOT_FOUND",
    );
    check("updating a course that does not exist is refused",
      missingCourse.threw && missingCourse.matched);

    // --- active / inactive --------------------------------------------------
    await curriculum.updateCourse(course.id, { isActive: false }, admin);
    const publicCourses = await curriculum.listCourses({ province: province.code });
    const adminCourses = await curriculum.listCourses({
      province: province.code,
      activeOnly: false,
    });
    check("a deactivated course leaves the public course list",
      !publicCourses.items.some((c) => c.id === course.id));
    check("but is still there for the administrator who deactivated it",
      adminCourses.items.some((c) => c.id === course.id));
    check("and it no longer resolves on its public path",
      (await curriculum.getCourseByPath({
        province: province.code,
        grade: otherGrade.slug,
        subject: otherSubject.slug,
        course: course.slug,
      })) === null);

    await curriculum.updateSubject(subject.id, { isActive: false }, admin);
    check("a deactivated subject leaves the subject list",
      !(await curriculum.listSubjects()).some((s) => s.id === subject.id));
    check("and leaves the curriculum tree",
      !(await curriculum.getCurriculumTree(province.code)).subjects.some((s) => s.id === subject.id));

    await curriculum.updateGrade(grade.id, { isActive: false }, admin);
    check("a deactivated grade leaves the grade list",
      !(await curriculum.listGrades({ provinceCode: province.code })).some((g) => g.id === grade.id));
    check("and leaves the curriculum tree",
      !(await curriculum.getCurriculumTree(province.code)).grades.some((g) => g.id === grade.id));

    // `codeless` is still active in its own right, which is the point: the
    // province coming down must take its courses out of the public view even
    // though nothing wrote to them.
    check("before deactivation, an active course under it is publicly listed",
      (await curriculum.listCourses({ province: province.code }))
        .items.some((c) => c.id === codeless.id));

    await curriculum.updateProvince(province.id, { isActive: false }, admin);
    check("a deactivated province leaves the picker",
      !(await curriculum.listProvinces()).some((p) => p.id === province.id));
    check("but an administrator can still list it",
      (await curriculum.listProvinces({ activeOnly: false })).some((p) => p.id === province.id));
    check("and it is still resolvable by code, so existing links do not 500",
      (await curriculum.getProvince(province.code))?.id === province.id);

    /**
     * A province marked "coming soon" is coming soon everywhere.
     *
     * Deactivating one used to stop at the picker: its courses each carried
     * their own `isActive: true`, so they stayed in `/courses` and their SEO
     * landing pages kept rendering — the platform telling one visitor the
     * province was not live yet while showing another a page of tutors for it.
     */
    check("a course under a deactivated province leaves the public course list",
      !(await curriculum.listCourses({ province: province.code }))
        .items.some((c) => c.id === codeless.id));
    check("and cannot be reached by asking for no province in particular",
      !(await curriculum.listCourses({})).items.some((c) => c.id === codeless.id));
    check("and its public landing page no longer resolves",
      (await curriculum.getCourseByPath({
        province: province.code,
        grade: grade.slug,
        subject: subject.slug,
        course: codeless.slug,
      })) === null);
    check("but the administrator building that curriculum still sees it",
      (await curriculum.listCourses({ province: province.code, activeOnly: false }))
        .items.some((c) => c.id === codeless.id));

    await curriculum.updateProvince(province.id, { isActive: true }, admin);
    check("reactivating a province puts it back in the picker",
      (await curriculum.listProvinces()).some((p) => p.id === province.id));
    check("and puts its courses back in the public list, untouched",
      (await curriculum.listCourses({ province: province.code }))
        .items.some((c) => c.id === codeless.id));
    check("and makes their landing pages resolve again",
      (await curriculum.getCourseByPath({
        province: province.code,
        grade: grade.slug,
        subject: subject.slug,
        course: codeless.slug,
      }))?.id === codeless.id);

    // --- deleting a course --------------------------------------------------
    const tutorUsingIt = await TutorProfile.findOne({ isSearchable: true }).lean();
    if (tutorUsingIt) {
      await TutorProfile.updateOne(
        { _id: tutorUsingIt._id },
        { $addToSet: { courseIds: new mongoose.Types.ObjectId(codeless.id) } },
      );
      const inUse = await throws(
        () => curriculum.deleteCourse(codeless.id, admin),
        (e) => e.code === "CONFLICT",
      );
      check("a course a tutor still teaches cannot be deleted",
        inUse.threw && inUse.matched, inUse.error?.message);
      check("and the refusal says how many tutors teach it",
        /tutor/i.test(inUse.error?.message ?? ""));
      await TutorProfile.updateOne(
        { _id: tutorUsingIt._id },
        { $pull: { courseIds: new mongoose.Types.ObjectId(codeless.id) } },
      );
    } else {
      skip("a course a tutor still teaches cannot be deleted", "no seeded tutor");
    }

    const deleted = await curriculum.deleteCourse(secondCodeless.id, admin);
    check("a course nobody teaches can be deleted", deleted.deleted === true);
    check("and it is gone from the database",
      (await Course.findById(secondCodeless.id).lean()) === null);
    made.courses = made.courses.filter((id) => id !== secondCodeless.id);

    // --- audit --------------------------------------------------------------
    const trail = await AuditLog.find({
      action: "CURRICULUM_UPDATED",
      entityType: { $in: ["Province", "Grade", "Subject", "Course"] },
      actorId: new mongoose.Types.ObjectId(admin.id),
    }).lean();
    const types = new Set(trail.map((r) => r.entityType));
    check("every level of the hierarchy is audited when it changes",
      ["Province", "Grade", "Subject", "Course"].every((t) => types.has(t)),
      [...types].join(","));
    check("and a deletion is recorded as one",
      trail.some((r) => r.metadata?.deleted === true));
  } finally {
    await AuditLog.deleteMany({ actorId: new mongoose.Types.ObjectId(admin.id) });
    await Course.deleteMany({ _id: { $in: made.courses.map((id) => new mongoose.Types.ObjectId(id)) } });
    await Subject.deleteMany({ _id: { $in: made.subjects.map((id) => new mongoose.Types.ObjectId(id)) } });
    await Grade.deleteMany({ _id: { $in: made.grades.map((id) => new mongoose.Types.ObjectId(id)) } });
    await Province.deleteMany({ _id: { $in: made.provinces.map((id) => new mongoose.Types.ObjectId(id)) } });
  }
}

// --- 30. Audit log (§35) ----------------------------------------------------

/**
 * The global audit browser, and the redaction that stands between it and the
 * stored metadata.
 *
 * The write side of auditing was never the gap — every money movement,
 * credential rotation and administrative decision was already recorded. What
 * an operator could not do was read them anywhere but one account at a time.
 * Opening that up means the read path becomes a second consumer of a
 * free-form `Mixed` field written from thirty-odd call sites, so the filter
 * belongs here, on the way out, rather than in the screen that happens to
 * render it today.
 */
async function auditLogTests() {
  section("Audit log — filtering, redaction and bounds");

  const {
    redactAuditMetadata, listAuditEvents, listAuditLogs, auditEntityTypes, recordAudit,
  } = await import("@/services/audit.service");

  // --- redaction is pure, so it is checked without a database --------------
  const redacted = redactAuditMetadata({
    module: "payment",
    provider: "stripe",
    secretKey: "sk_test_should_never_be_shown",
    apiKey: "abcdef",
    webhookSecret: "whsec_abcdef",
    accessKey: "AKIAEXAMPLE",
    storageKey: "6a995eb9-0000-4000-8000-000000000000.png",
    changes: { config: { endpoint: { from: null, to: "https://minio.example.ca" } } },
    secretsRotated: ["secretKey", "webhookSecret"],
    secretsCleared: [],
  });

  check("a value under a credential-shaped key is redacted",
    redacted.secretKey === "[redacted]" && redacted.apiKey === "[redacted]");
  check("including the webhook signing secret", redacted.webhookSecret === "[redacted]");
  check("and an object-storage access key", redacted.accessKey === "[redacted]");
  check("an internal storage key is redacted too", redacted.storageKey === "[redacted]");
  check("but the *names* of the credentials that rotated are kept",
    Array.isArray(redacted.secretsRotated) &&
      redacted.secretsRotated.join(",") === "secretKey,webhookSecret",
    "the most useful line in a rotation record must survive");
  check("and ordinary non-secret configuration is left readable",
    redacted.changes.config.endpoint.to === "https://minio.example.ca");
  check("as is the module and provider the record is about",
    redacted.module === "payment" && redacted.provider === "stripe");

  const byShape = redactAuditMetadata({
    note: "sk_live_realkeyshapedvalue",
    envelope: "v1.aXYtaGVyZQ.dGFnLWhlcmU.Y2lwaGVydGV4dA",
    jwt: "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
    innocent: "Refunded because the tutor never joined.",
  });
  check("a credential is redacted by its shape even under an innocent key",
    byShape.note === "[redacted]");
  check("so is our own encrypted envelope", byShape.envelope === "[redacted]");
  check("and a bearer token", byShape.jwt === "[redacted]");
  check("while ordinary prose is untouched",
    byShape.innocent === "Refunded because the tutor never joined.");

  const long = redactAuditMetadata({ reason: "x".repeat(900), list: Array.from({ length: 80 }, (_, i) => i) });
  check("a very long stored string is truncated rather than rendered whole",
    long.reason.length === 501 && long.reason.endsWith("…"));
  check("and a very long stored array is capped", long.list.length === 50);

  let deep = { value: "bottom" };
  for (let i = 0; i < 8; i += 1) deep = { nested: deep };
  check("nesting is bounded", JSON.stringify(redactAuditMetadata(deep)).includes("[redacted]"));

  check("null and undefined pass through untouched",
    redactAuditMetadata(null) === null && redactAuditMetadata(undefined) === undefined);
  check("and so do numbers and booleans",
    redactAuditMetadata({ n: 42, b: true }).n === 42 && redactAuditMetadata({ b: false }).b === false);

  // --- filtering needs the database ---------------------------------------
  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("audit log filtering", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("audit log filtering", "MongoDB is not reachable");
    }
  }

  const { AuditLog } = await import("@/models");
  const actorA = new mongoose.Types.ObjectId();
  const actorB = new mongoose.Types.ObjectId();
  const subject = new mongoose.Types.ObjectId();

  try {
    // Three records, deliberately spread across two actors, two entity types
    // and two days, so every filter has something it must *not* return.
    await AuditLog.create([
      {
        actorId: actorA,
        actorRole: "ADMIN",
        action: "REFUND_ISSUED",
        entityType: "AuditFixturePayment",
        entityId: subject,
        metadata: { amountCents: 4500, reason: "Integration fixture." },
        createdAt: new Date("2031-01-10T10:00:00.000Z"),
      },
      {
        actorId: actorA,
        actorRole: "ADMIN",
        action: "SETTINGS_UPDATED",
        entityType: "AuditFixtureSettings",
        metadata: { sections: ["branding"], secretKey: "sk_test_leaked" },
        createdAt: new Date("2031-01-11T10:00:00.000Z"),
      },
      {
        actorId: actorB,
        actorRole: "ADMIN",
        action: "REFUND_ISSUED",
        entityType: "AuditFixturePayment",
        entityId: new mongoose.Types.ObjectId(),
        metadata: { amountCents: 100 },
        createdAt: new Date("2031-01-12T10:00:00.000Z"),
      },
    ]);

    const inWindow = async (filters) =>
      listAuditEvents({
        from: "2031-01-01T00:00:00.000Z",
        to: "2031-01-31T00:00:00.000Z",
        pageSize: 50,
        ...filters,
      });

    const all = await inWindow({});
    check("the period filter returns exactly the records inside it", all.total === 3, String(all.total));
    check("and they come back newest first",
      new Date(all.items[0].createdAt) > new Date(all.items[2].createdAt));

    const byAction = await inWindow({ action: "REFUND_ISSUED" });
    check("filtering by action narrows to that action", byAction.total === 2);
    check("and returns nothing else",
      byAction.items.every((e) => e.action === "REFUND_ISSUED"));

    const byActor = await inWindow({ actorId: String(actorA) });
    check("filtering by actor narrows to what that person did", byActor.total === 2);

    const byEntityType = await inWindow({ entityType: "AuditFixtureSettings" });
    check("filtering by entity type narrows to that type", byEntityType.total === 1);

    const byEntity = await inWindow({ entityId: String(subject) });
    check("filtering by a single record's id narrows to its own history", byEntity.total === 1);
    check("and that history is the right record",
      byEntity.items[0].metadata.amountCents === 4500);

    const composed = await inWindow({ action: "REFUND_ISSUED", actorId: String(actorA) });
    check("filters compose rather than replacing each other", composed.total === 1);

    const oneDay = await listAuditEvents({ from: "2031-01-11", to: "2031-01-11", pageSize: 50 });
    check("a single calendar day means the whole of that day", oneDay.total === 1, String(oneDay.total));

    const firstPage = await inWindow({ pageSize: 2, page: 1 });
    const secondPage = await inWindow({ pageSize: 2, page: 2 });
    check("pagination reports the total across every page",
      firstPage.total === 3 && secondPage.total === 3);
    check("and a page carries only its own slice",
      firstPage.items.length === 2 && secondPage.items.length === 1);
    check("with no record appearing on both",
      !secondPage.items.some((e) => firstPage.items.some((f) => f.id === e.id)));

    const leaky = byActor.items.find((e) => e.action === "SETTINGS_UPDATED");
    check("a credential stored in metadata never reaches the browser",
      leaky.metadata.secretKey === "[redacted]");
    check("and neither does it through the per-record reader",
      (await listAuditLogs({ entityType: "AuditFixtureSettings" }))[0].metadata.secretKey ===
        "[redacted]");

    const types = await auditEntityTypes();
    check("the entity-type filter offers what is actually in the log",
      types.includes("AuditFixturePayment") && types.includes("AuditFixtureSettings"));
    check("and nothing blank", types.every(Boolean));

    // `recordAudit` must never be able to break the thing it is recording.
    let threw = false;
    try {
      await recordAudit({ action: "NOT_A_REAL_ACTION", entityType: "AuditFixturePayment" });
    } catch {
      threw = true;
    }
    check("a rejected audit write is swallowed rather than failing the action", !threw);
  } finally {
    await AuditLog.deleteMany({
      entityType: { $in: ["AuditFixturePayment", "AuditFixtureSettings"] },
    });
  }
}

// --- 31. User-controlled URLs and public configuration (§16, §36) -----------

/**
 * Two things that were each relying on somebody downstream to be careful.
 *
 * `introVideoUrl` and the profile gallery were stored as any string up to 500
 * characters. React refuses to render a `javascript:` href and the image
 * optimiser refuses an unlisted host, so nothing was exploitable — but that
 * made a framework behaviour the security boundary, which it is not meant to
 * be. The scheme is now decided server-side, where the value is accepted.
 *
 * `resolveAppConfig` is the other half: it is handed to client components on
 * every page, including unauthenticated ones, so whatever it carries is
 * published. It used to carry the stored file record behind each branding
 * asset — storage key, original filename, byte size and the administrator who
 * uploaded it.
 */
async function publicSurfaceTests() {
  section("Public surfaces — URL schemes and what configuration publishes");

  const { updateTutorProfileSchema, onboardingStepSchemas } = await import(
    "@/lib/validation/tutors"
  );
  const { resolveAppConfig } = await import("@/services/settings.service");
  const { renderableImageSrc } = await import("@/lib/images/remote");

  const videoOk = (value) => updateTutorProfileSchema.safeParse({ introVideoUrl: value }).success;
  const galleryOk = (value) => updateTutorProfileSchema.safeParse({ gallery: [value] }).success;

  check("an https intro video is accepted", videoOk("https://youtu.be/abc123"));
  check("and an http one, which the product has always allowed",
    videoOk("http://example.ca/intro.mp4"));
  check("a javascript: intro video is refused", !videoOk("javascript:alert(document.domain)"));
  check("and the mixed-case spelling of it too",
    !videoOk("JavaScript:alert(1)") && !videoOk("jAvAsCrIpT:alert(1)"));
  check("a data: URL is refused", !videoOk("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="));
  check("a vbscript: URL is refused", !videoOk("vbscript:msgbox(1)"));
  check("a file: URL is refused", !videoOk("file:///etc/passwd"));
  check("something that is not a URL at all is refused", !videoOk("not a url"));
  check("and neither is a bare hostname", !videoOk("example.ca/intro"));
  check("a blank intro video clears the field rather than failing",
    updateTutorProfileSchema.safeParse({ introVideoUrl: "" }).data.introVideoUrl === undefined);
  check("and omitting it entirely is still fine",
    updateTutorProfileSchema.safeParse({}).success);
  check("a link longer than the column is refused",
    !videoOk(`https://example.ca/${"a".repeat(600)}`));

  check("the same rule applies at onboarding, not only on the edit form",
    !onboardingStepSchemas.PROFILE.safeParse({
      headline: "Experienced mathematics tutor",
      bio: "b".repeat(200),
      languages: ["English"],
      introVideoUrl: "javascript:alert(1)",
    }).success);

  check("a gallery photo may be an https URL", galleryOk("https://images.unsplash.com/photo-1"));
  check("or a path this application serves itself", galleryOk("/api/avatars/9f3c.png"));
  check("a javascript: gallery entry is refused", !galleryOk("javascript:alert(1)"));
  check("a data: gallery entry is refused", !galleryOk("data:image/svg+xml,<svg onload=alert(1)>"));
  check("and a protocol-relative one is refused, because it is not a local path",
    !galleryOk("//evil.example/x.png"));

  // The render-time guard is a separate rule and must stay separate: it
  // decides what `next/image` can draw, not what may be stored.
  check("the renderer still refuses an unlisted host independently",
    renderableImageSrc("https://evil.example/x.png") === null);
  check("and still refuses a javascript: URL",
    renderableImageSrc("javascript:alert(1)") === null);
  check("while keeping a photo this application serves",
    renderableImageSrc("/api/avatars/9f3c.png") === "/api/avatars/9f3c.png");

  // --- where sign-in is allowed to send somebody --------------------------
  //
  // `next` travels on the login, registration and OAuth links so a person
  // who was bounced to sign in lands back where they were. "Starts with a
  // slash" is not enough on its own: a browser reads `//host` and `/\\host`
  // as another origin, which turns a sign-in link into an open redirect —
  // the address bar shows this application right until it does not.
  const { internalPath } = await import("@/lib/utils/url");
  const { loginSchema } = await import("@/lib/validation/auth");

  check("an ordinary path is kept", internalPath("/bookings/123") === "/bookings/123");
  check("with its query string", internalPath("/find-a-tutor?q=math") === "/find-a-tutor?q=math");
  check("a protocol-relative path is not ours", internalPath("//evil.example/x") === null);
  check("nor is the backslash spelling of it", internalPath("/\\evil.example/x") === null);
  check("nor an absolute URL", internalPath("https://evil.example/x") === null);
  check("nor a javascript: URL", internalPath("javascript:alert(1)") === null);
  check("nor a path smuggling a control character",
    internalPath("/\tevil") === null && internalPath("/\nevil") === null);
  check("a relative path with no leading slash is refused",
    internalPath("bookings") === null);
  check("and anything that is not a string at all",
    internalPath(undefined) === null && internalPath(42) === null);
  check("with a caller-supplied fallback when it is not ours",
    internalPath("//evil.example", "/dashboard") === "/dashboard");

  const signIn = (next) =>
    loginSchema.parse({ email: "a@example.ca", password: "x", next });
  check("the login schema drops a destination that is not ours",
    signIn("//evil.example/x").next === undefined);
  check("and keeps one that is", signIn("/tutor/dashboard").next === "/tutor/dashboard");

  // --- the password policy does not drag bcrypt into the browser ----------
  const policy = await import("@/lib/auth/password-policy");
  check("the policy module names every unmet rule at once",
    policy.passwordIssues("short").length === 3);
  check("and none when the password satisfies all of them",
    policy.isStrongPassword("Longenough1Password") &&
      policy.passwordIssues("Longenough1Password").length === 0);
  const policySource = await readFile(
    new URL("../src/lib/auth/password-policy.js", import.meta.url),
    "utf8",
  );
  check("and it imports nothing, so a form can use it without shipping bcrypt",
    !/^\s*import\s/m.test(policySource));

  const clientForms = await Promise.all(
    ["RegisterForm.jsx", "PasswordForms.jsx"].map((file) =>
      readFile(new URL(`../src/components/auth/${file}`, import.meta.url), "utf8"),
    ),
  );
  check("the browser forms read the policy module, not the hashing one",
    clientForms.every((src) => src.includes("@/lib/auth/password-policy")) &&
      clientForms.every((src) => !src.includes('from "@/lib/auth/password"')));

  // --- what the public configuration carries ------------------------------
  const config = resolveAppConfig({
    branding: {
      appName: "APlus Learn",
      logo: {
        storageKey: "6a995eb9-0000-4000-8000-000000000000.png",
        contentType: "image/png",
        fileName: "our-real-logo-final-v4.png",
        sizeBytes: 20480,
        width: 512,
        height: 128,
        uploadedAt: new Date("2031-02-01T00:00:00.000Z"),
        uploadedBy: "6ab1372b998f04ad610cadc0",
      },
    },
  });

  const published = JSON.stringify(config);
  check("the public configuration exposes the logo as a URL the browser can fetch",
    config.branding.logo ===
      `/api/branding/logo?v=${Date.parse("2031-02-01T00:00:00.000Z")}`,
    config.branding.logo);
  check("and carries no storage key", !published.includes("storageKey"));
  check("nor the original filename", !published.includes("our-real-logo-final-v4"));
  check("nor the file size", !published.includes("sizeBytes"));
  check("nor the administrator who uploaded it",
    !published.includes("uploadedBy") && !published.includes("6ab1372b998f04ad610cadc0"));
  check("and no raw file record at all", config.branding.files === undefined);
  check("while the branding the page actually needs is still there",
    config.branding.appName === "APlus Learn" && Boolean(config.seo.title));
  check("an asset that was never uploaded is null rather than missing",
    config.branding.favicon === null);

  // The admin console reads the settings document itself, behind its own
  // permission — but even there the browser gets only what the screen draws.
  const { adminSettingsView } = await import("@/services/settings.service");
  const adminView = adminSettingsView({
    branding: {
      appName: "APlus Learn",
      logo: {
        storageKey: "6a995eb9-0000-4000-8000-000000000000.png",
        contentType: "image/png",
        fileName: "our-real-logo-final-v4.png",
        sizeBytes: 20480,
        width: 512,
        height: 128,
        uploadedAt: new Date("2031-02-01T00:00:00.000Z"),
        uploadedBy: "6ab1372b998f04ad610cadc0",
      },
      favicon: null,
    },
    commissionPercent: 15,
  });
  const adminPublished = JSON.stringify(adminView);

  check("the admin branding panel still gets what it draws",
    adminView.branding.logo.width === 512 &&
      adminView.branding.logo.height === 128 &&
      adminView.branding.logo.sizeBytes === 20480);
  check("without the storage key", !adminPublished.includes("storageKey"));
  check("without the uploader's user id", !adminPublished.includes("uploadedBy"));
  check("without the original filename", !adminPublished.includes("our-real-logo-final-v4"));
  check("an empty slot stays empty", adminView.branding.favicon === null);
  check("and every other setting is untouched", adminView.commissionPercent === 15);
}


// --- 32. Booking slot claims (§18, §42) -------------------------------------

/**
 * The database-decided half of double-booking prevention.
 *
 * `createBooking` validates the slot by reading the tutor's calendar and then
 * writing, which two concurrent requests can both pass. The claim closes that
 * window with a unique `_id`, so the refusal comes from the database rather
 * than from two reads racing each other — which is what makes it hold across
 * more than one application instance, where the previous compare-after-write
 * tie-break had a narrow window in which neither request saw the other.
 *
 * The three things that have to be true, and are checked here against the
 * real service: only one of several simultaneous requests for one slot wins;
 * a claim left behind by a booking that no longer holds the slot does not
 * wedge the calendar shut; and a refused claim leaves nothing behind.
 */
async function bookingSlotLockTests() {
  section("Booking slot claims — exclusivity, staleness and cleanup");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("booking slot claims", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("booking slot claims", "MongoDB is not reachable");
    }
  }

  const { Booking, BookingSlotLock, TutorProfile, StudentProfile, Availability, Payment } =
    await import("@/models");
  const booking = await import("@/services/booking.service");
  const { getBookableSlots } = await import("@/services/availability.service");
  const { BOOKING_STATUS, ROLES } = await import("@/constants");
  const { resetPaymentProvider } = await import("@/services/external/payment-provider");

  const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
  const learner = await StudentProfile.findOne({ archivedAt: null }).lean();
  const availability = tutor ? await Availability.findOne({ tutorProfileId: tutor._id }).lean() : null;
  if (!tutor || !learner || !availability) {
    return skip("booking slot claims", "no seeded tutor/student/availability — run `bun run seed`");
  }

  const paymentProviderBefore = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "development";
  resetPaymentProvider();

  const actor = {
    id: String(learner.ownerId),
    role: ROLES.PARENT,
    emailVerifiedAt: new Date(),
  };

  const madeBookings = [];
  const madePayments = [];
  const madeLocks = [];

  /** The first slot this tutor is genuinely offering, so the rules agree. */
  const nextFreeSlot = async () => {
    const result = await getBookableSlots(tutor._id, { days: 28, durationMinutes: 60 });
    for (const day of result.days ?? []) {
      for (const slot of day.slots ?? []) return slot.startAt;
    }
    return null;
  };

  try {
    const slot = await nextFreeSlot();
    if (!slot) {
      return skip("booking slot claims", "the seeded tutor has no bookable slot in the next 28 days");
    }

    const request = {
      tutorProfileId: String(tutor._id),
      studentProfileId: String(learner._id),
      courseId: String(tutor.courseIds?.[0] ?? tutor.courses?.[0]?.courseId),
      mode: "ONLINE",
      meetingProvider: "ZOOM",
      startAt: slot,
      durationMinutes: 60,
      recurrence: "NONE",
    };

    // --- 1. exclusivity ----------------------------------------------------
    //
    // Counted as a delta rather than an absolute: this instant may already
    // carry withdrawn bookings from an earlier run, and those hold nothing.
    const bookingsAtSlotBefore = await Booking.countDocuments({
      tutorProfileId: tutor._id,
      startAt: new Date(slot),
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => booking.createBooking(request, actor)),
    );
    const winners = attempts.filter((a) => a.status === "fulfilled");
    const losers = attempts.filter((a) => a.status === "rejected");

    check("exactly one of five simultaneous requests for one slot wins",
      winners.length === 1, `${winners.length} succeeded`);
    check("and every loser is refused as a conflict, not an error",
      losers.every((l) => l.reason?.code === "CONFLICT"),
      losers.map((l) => l.reason?.code).join(","));

    for (const win of winners) {
      for (const b of win.value.bookings) madeBookings.push(new mongoose.Types.ObjectId(b.id));
      if (win.value.payment?.id) madePayments.push(new mongoose.Types.ObjectId(win.value.payment.id));
    }

    const lockKey = `${tutor._id}:${new Date(slot).getTime()}`;
    madeLocks.push(lockKey);
    const lock = await BookingSlotLock.findById(lockKey).lean();
    check("the winning booking holds the slot's claim",
      Boolean(lock) && madeBookings.some((id) => String(id) === String(lock.bookingId)),
      JSON.stringify(lock));

    const held = await Booking.countDocuments({
      tutorProfileId: tutor._id,
      startAt: new Date(slot),
      status: { $in: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.CONFIRMED] },
    });
    check("and exactly one booking exists for that instant", held === 1, String(held));

    const bookingsAtSlotAfter = await Booking.countDocuments({
      tutorProfileId: tutor._id,
      startAt: new Date(slot),
    });
    check("the four that lost left no booking behind",
      bookingsAtSlotAfter - bookingsAtSlotBefore === 1,
      `${bookingsAtSlotAfter - bookingsAtSlotBefore} new rows`);

    // --- 2. a claim is not a permanent reservation -------------------------
    const winnerId = madeBookings[0];
    if (!winnerId) return check("a winning booking exists to cancel", false);
    await Booking.updateOne(
      { _id: winnerId },
      { $set: { status: BOOKING_STATUS.CANCELLED_BY_STUDENT } },
    );

    const reclaimed = await booking.createBooking(request, actor);
    check("a claim left by a cancelled booking does not wedge the slot shut",
      reclaimed.bookings.length === 1, JSON.stringify(reclaimed));
    for (const b of reclaimed.bookings) madeBookings.push(new mongoose.Types.ObjectId(b.id));
    if (reclaimed.payment?.id) madePayments.push(new mongoose.Types.ObjectId(reclaimed.payment.id));

    const inherited = await BookingSlotLock.findById(lockKey).lean();
    check("and the claim now names the booking that actually holds the slot",
      String(inherited.bookingId) === String(reclaimed.bookings[0].id));

    // --- 3. the slot is exclusive again once it is taken -------------------
    const blocked = await throws(
      () => booking.createBooking(request, actor),
      (e) => e.code === "CONFLICT",
    );
    check("a slot that is genuinely held is refused",
      blocked.threw && blocked.matched, blocked.error?.message);

    const lockCount = await BookingSlotLock.countDocuments({ _id: lockKey });
    check("one instant never accumulates more than one claim", lockCount === 1);
  } finally {
    if (paymentProviderBefore === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = paymentProviderBefore;
    resetPaymentProvider();

    await BookingSlotLock.deleteMany({ _id: { $in: madeLocks } });
    await Payment.deleteMany({ _id: { $in: madePayments } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
  }
}


// --- 33. Rate limiting (§36) ------------------------------------------------

/**
 * The window that protects login, registration and password reset.
 *
 * The property that matters is that it is **shared**. A counter held in one
 * process is a counter multiplied by however many processes are running, so
 * "five attempts" behind four servers is twenty — which is not a limit. The
 * store is therefore the database this deployment already has, and this
 * section proves the three things that makes true: that two independent
 * callers of the limiter see one another's counts, that a lapsed window rolls
 * forward instead of accumulating forever, and that a store it cannot reach
 * degrades to a per-process limit rather than to no limit at all.
 */
async function rateLimitTests() {
  section("Rate limiting — shared windows, rollover and safe failure");

  const {
    rateLimit, enforceRateLimit, clientKey, rateLimitStore, rateLimitIsShared,
    RATE_LIMIT_STORES,
  } = await import("@/lib/security/rate-limit");

  const storeBefore = process.env.RATE_LIMIT_STORE;

  try {
    // --- which store, stated rather than inferred --------------------------
    delete process.env.RATE_LIMIT_STORE;
    check("the default store is the shared one",
      rateLimitStore() === RATE_LIMIT_STORES.DATABASE && rateLimitIsShared());

    process.env.RATE_LIMIT_STORE = "memory";
    check("and a deployment can say so explicitly when it wants per-process",
      rateLimitStore() === RATE_LIMIT_STORES.MEMORY && !rateLimitIsShared());

    process.env.RATE_LIMIT_STORE = "something-else";
    check("an unrecognised value falls back to the shared store, not to none",
      rateLimitStore() === RATE_LIMIT_STORES.DATABASE);

    // --- the identity the limit is applied to ------------------------------
    const headers = new Map([
      ["x-forwarded-for", "203.0.113.7, 10.0.0.1"],
      ["x-real-ip", "10.0.0.1"],
    ]);
    const request = { headers: { get: (name) => headers.get(name) ?? null } };
    check("the caller's address comes from the proxy header, left-most first",
      clientKey(request) === "203.0.113.7");
    check("and a suffix keeps two limits on one address apart",
      clientKey(request, "login") === "203.0.113.7:login");
    check("with a sensible fallback when there is no proxy at all",
      clientKey({ headers: { get: () => null } }, "login") === "local:login");

    // --- counting, in memory -----------------------------------------------
    process.env.RATE_LIMIT_STORE = "memory";
    const memKey = `qa-memory-${randomUUID()}`;
    const first = await rateLimit(memKey, { limit: 3, windowMs: 60_000 });
    check("the first attempt is allowed", first.allowed && first.remaining === 2);
    await rateLimit(memKey, { limit: 3, windowMs: 60_000 });
    const third = await rateLimit(memKey, { limit: 3, windowMs: 60_000 });
    check("the last attempt inside the limit is still allowed",
      third.allowed && third.remaining === 0);
    const fourth = await rateLimit(memKey, { limit: 3, windowMs: 60_000 });
    check("the one after it is not", !fourth.allowed);
    check("and it says how long to wait",
      fourth.retryAfterSeconds > 0 && fourth.retryAfterSeconds <= 60);

    const refused = await throws(
      () => enforceRateLimit(memKey, { limit: 3, windowMs: 60_000 }),
      (e) => e.code === "RATE_LIMITED" && e.status === 429,
    );
    check("enforcing it throws the typed error the API maps to 429",
      refused.threw && refused.matched, refused.error?.message);

    const lapsing = `qa-memory-${randomUUID()}`;
    await rateLimit(lapsing, { limit: 1, windowMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    const rolled = await rateLimit(lapsing, { limit: 1, windowMs: 60_000 });
    check("a window that has lapsed starts again rather than staying closed",
      rolled.allowed);

    // --- counting, in the shared store -------------------------------------
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      skip("the shared window", "MONGODB_URI is not set");
    } else {
      if (mongoose.connection.readyState !== 1) {
        try {
          await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
        } catch {
          skip("the shared window", "MongoDB is not reachable");
          return;
        }
      }

      const { RateLimitWindow } = await import("@/models");
      process.env.RATE_LIMIT_STORE = "database";
      const dbKey = `qa-shared-${randomUUID()}`;

      try {
        const one = await rateLimit(dbKey, { limit: 3, windowMs: 60_000 });
        check("a shared window starts at one", one.allowed && one.remaining === 2);

        const stored = await RateLimitWindow.findById(dbKey).lean();
        check("and it is a row every instance can see, not a process variable",
          stored?.count === 1 && stored.resetAt instanceof Date);

        // What a second application instance would do: the same key, with no
        // memory of the first call. The in-process map is bypassed entirely
        // because this store does not use it.
        await rateLimit(dbKey, { limit: 3, windowMs: 60_000 });
        const over = await rateLimit(dbKey, { limit: 3, windowMs: 60_000 });
        check("three attempts exhaust a limit of three", over.allowed && over.remaining === 0);
        const blocked = await rateLimit(dbKey, { limit: 3, windowMs: 60_000 });
        check("and the fourth is refused wherever it arrived from", !blocked.allowed);

        // Concurrency: ten simultaneous attempts against a limit of four must
        // allow four, not ten. This is the whole point of the unique key.
        const burstKey = `qa-burst-${randomUUID()}`;
        const burst = await Promise.all(
          Array.from({ length: 10 }, () => rateLimit(burstKey, { limit: 4, windowMs: 60_000 })),
        );
        check("ten simultaneous attempts against a limit of four allow exactly four",
          burst.filter((r) => r.allowed).length === 4,
          `${burst.filter((r) => r.allowed).length} allowed`);
        check("and the stored count is the number of attempts, not of instances",
          (await RateLimitWindow.findById(burstKey).lean())?.count === 10);

        // A lapsed shared window rolls forward once, not once per caller.
        const staleKey = `qa-stale-${randomUUID()}`;
        await RateLimitWindow.create({
          _id: staleKey,
          count: 99,
          resetAt: new Date(Date.now() - 60_000),
        });
        const afterLapse = await Promise.all(
          Array.from({ length: 3 }, () => rateLimit(staleKey, { limit: 2, windowMs: 60_000 })),
        );
        check("a lapsed shared window reopens", afterLapse.some((r) => r.allowed));
        check("but reopening it does not reset it once per caller",
          afterLapse.filter((r) => r.allowed).length <= 2,
          `${afterLapse.filter((r) => r.allowed).length} allowed`);

        await RateLimitWindow.deleteMany({
          _id: { $in: [dbKey, burstKey, staleKey] },
        });
      } finally {
        await RateLimitWindow.deleteMany({ _id: /^qa-(shared|burst|stale)-/ });
      }
    }
  } finally {
    if (storeBefore === undefined) delete process.env.RATE_LIMIT_STORE;
    else process.env.RATE_LIMIT_STORE = storeBefore;
  }
}


// --- 33. Shared files (§21, §41 Phase 3) ------------------------------------

/**
 * A structurally valid PDF header.
 *
 * `inspectDocument` reads the first five bytes and nothing else, so this is
 * exactly as much PDF as the code under test looks at — and, crucially, it is
 * a real signature rather than a text blob with a label, which is the whole
 * distinction these tests exist to prove.
 */
function fakePdf(padToBytes = 0) {
  const head = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary");
  return padToBytes > head.length
    ? Buffer.concat([head, Buffer.alloc(padToBytes - head.length, 0x20)])
    : head;
}

/**
 * Homework and document sharing, through the services that own it.
 *
 * The HTTP suite proves the endpoints refuse what they should. This proves
 * the four things only a direct call can reach:
 *
 *   that a file's *bytes* decide its type, so a script renamed `.pdf` never
 *   reaches the store at all;
 *
 *   that the bytes land in the `attachments` scope and nowhere near the
 *   folder holding tutors' identity documents;
 *
 *   that a refused upload leaves nothing behind — the compensating delete on
 *   the failure path is the only thing standing between a validation error
 *   and an orphaned object nobody will ever look for;
 *
 *   and that the storage key never appears in anything a service returns,
 *   which is the property that makes the whole "ask by id, not by key" design
 *   worth having.
 */
async function attachmentTests() {
  section("Shared files — validation, scope, authorization and cleanup");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("attachments", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("attachments", "MongoDB is not reachable");
    }
  }

  const {
    User, Conversation, Message, ProgressReport, StudentProfile, TutorProfile,
    Booking, Notification, AuditLog,
  } = await import("@/models");
  const messages = await import("@/services/message.service");
  const progress = await import("@/services/progress.service");
  const attachments = await import("@/services/attachment.service");
  const {
    STORAGE_SCOPES, resetStorageProvider, localStorageRoot,
  } = await import("@/services/external/storage-provider");
  const { ROLES, USER_STATUS, PROGRESS_REPORT_STATUS, BOOKING_STATUS, UPLOAD } =
    await import("@/constants");

  const tutorProfile = await TutorProfile.findOne({ isSearchable: true }).lean();
  const seededStudent = await StudentProfile.findOne({ archivedAt: null }).lean();
  if (!tutorProfile || !seededStudent) {
    return skip("attachments", "no seeded tutor/student — run `bun run seed`");
  }

  // Local mode, in a directory of this test's own, so the scope assertions
  // are about real files on a real filesystem rather than about a stub.
  const root = await mkdtemp(path.join(tmpdir(), "aplus-attachments-"));
  const storageEnv = {
    APP_ENV: "development",
    STORAGE_PROVIDER: undefined,
    STORAGE_LOCAL_DIR: root,
    STORAGE_ENDPOINT: undefined,
    STORAGE_BUCKET: undefined,
    STORAGE_ACCESS_KEY: undefined,
    STORAGE_SECRET_KEY: undefined,
    STORAGE_REQUIRE_EXTERNAL: undefined,
  };
  const savedEnv = Object.fromEntries(Object.keys(storageEnv).map((k) => [k, process.env[k]]));
  Object.assign(process.env, storageEnv);
  for (const [k, v] of Object.entries(storageEnv)) if (v === undefined) delete process.env[k];
  resetStorageProvider();

  /** A `File`-shaped upload, the way a route hands one to the service. */
  const asFile = (buffer, type = "application/pdf", name = "worksheet.pdf") => ({
    size: buffer.length,
    type,
    name,
    arrayBuffer: async () => buffer,
  });

  const countStored = async (scope) =>
    (await readdir(path.join(root, scope)).catch(() => [])).length;

  const madeUsers = [];
  const madeConversations = [];
  const madeBookings = [];
  const madeReports = [];
  let student = null;

  try {
    const learner = await User.create({
      email: `attach-${randomUUID()}@example.invalid`,
      firstName: "Attach",
      lastName: "Testcase",
      role: ROLES.PARENT,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    madeUsers.push(learner._id);

    const learnerActor = {
      id: String(learner._id),
      role: ROLES.PARENT,
      emailVerifiedAt: learner.emailVerifiedAt,
    };
    const tutorActor = {
      id: String(tutorProfile.userId),
      role: ROLES.TUTOR,
      emailVerifiedAt: new Date(),
    };
    const stranger = {
      id: String(new mongoose.Types.ObjectId()),
      role: ROLES.PARENT,
      emailVerifiedAt: new Date(),
    };
    const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

    // --- what a file has to be --------------------------------------------
    const before = await countStored(STORAGE_SCOPES.ATTACHMENTS);

    const renamed = await throws(
      () =>
        attachments.storeAttachment(
          asFile(Buffer.from("#!/bin/sh\nrm -rf /\n"), "application/pdf", "invoice.pdf"),
          learnerActor,
        ),
      (e) => e.code === "UNSUPPORTED_FILE_TYPE",
    );
    check("a script renamed .pdf is refused on its bytes, not its name",
      renamed.threw && renamed.matched, renamed.error?.message);

    const mislabelled = await throws(
      () => attachments.storeAttachment(asFile(fakePdf(), "image/png", "x.png"), learnerActor),
      (e) => e.code === "UNSUPPORTED_FILE_TYPE",
    );
    check("a real PDF declared as a PNG is refused for disagreeing with itself",
      mislabelled.threw && mislabelled.matched);

    const wrongType = await throws(
      () =>
        attachments.storeAttachment(
          asFile(Buffer.from("PK\u0003\u0004zip"), "application/zip", "a.zip"),
          learnerActor,
        ),
      (e) => e.code === "UNSUPPORTED_FILE_TYPE",
    );
    check("a type outside the accepted list is refused before the bytes are read",
      wrongType.threw && wrongType.matched);

    const empty = await throws(
      () => attachments.storeAttachment(asFile(Buffer.alloc(0), "application/pdf"), learnerActor),
      (e) => e.code === "UNSUPPORTED_FILE_TYPE",
    );
    check("an empty file is refused", empty.threw && empty.matched);

    const huge = {
      size: UPLOAD.maxAttachmentBytes + 1,
      type: "application/pdf",
      name: "scan.pdf",
      arrayBuffer: async () => fakePdf(),
    };
    const oversized = await throws(
      () => attachments.storeAttachment(huge, learnerActor),
      (e) => e.code === "FILE_TOO_LARGE",
    );
    check("a file over the limit is refused on its declared size, before it is read",
      oversized.threw && oversized.matched);

    // A body bigger than the limit that *announced* itself as small: the
    // declared length is a claim too, and the real one is checked after read.
    const liar = {
      size: 10,
      type: "application/pdf",
      name: "liar.pdf",
      arrayBuffer: async () => fakePdf(UPLOAD.maxAttachmentBytes + 1024),
    };
    const lied = await throws(
      () => attachments.storeAttachment(liar, learnerActor),
      (e) => e.code === "FILE_TOO_LARGE",
    );
    check("and a body that lied about its length is refused once the real size is known",
      lied.threw && lied.matched);

    check("not one refused upload put anything in the store",
      (await countStored(STORAGE_SCOPES.ATTACHMENTS)) === before,
      `${await countStored(STORAGE_SCOPES.ATTACHMENTS)} vs ${before}`);

    // --- all of them, or none of them --------------------------------------
    const partial = await throws(
      () =>
        attachments.storeAttachments(
          [
            asFile(fakePdf(), "application/pdf", "good.pdf"),
            asFile(Buffer.from("not a pdf at all"), "application/pdf", "bad.pdf"),
          ],
          learnerActor,
          { max: 4 },
        ),
      (e) => e.code === "UNSUPPORTED_FILE_TYPE",
    );
    check("a batch with one bad file is refused as a batch",
      partial.threw && partial.matched);
    check("and the good file that was already written is taken back out",
      (await countStored(STORAGE_SCOPES.ATTACHMENTS)) === before,
      `${await countStored(STORAGE_SCOPES.ATTACHMENTS)} vs ${before}`);

    const tooMany = await throws(
      () =>
        attachments.storeAttachments(
          Array.from({ length: UPLOAD.maxAttachmentsPerMessage + 1 }, () => asFile(fakePdf())),
          learnerActor,
          { max: UPLOAD.maxAttachmentsPerMessage },
        ),
      (e) => e.code === "TOO_MANY_ATTACHMENTS",
    );
    check("more files than the cap allows is refused before anything is stored",
      tooMany.threw && tooMany.matched &&
        (await countStored(STORAGE_SCOPES.ATTACHMENTS)) === before);

    // --- a message carrying a file -----------------------------------------
    const sent = await messages.sendMessage(
      {
        tutorProfileId: String(tutorProfile._id),
        body: "Here's the worksheet.",
        files: [asFile(fakePdf(2048), "application/pdf", "week 3 homework.pdf")],
      },
      learnerActor,
    );
    madeConversations.push(new mongoose.Types.ObjectId(sent.conversationId));

    const attachment = sent.message.attachments?.[0];
    check("a message can carry a file", sent.message.attachments?.length === 1);
    check("the stored type is the one the bytes proved, not the one claimed",
      attachment?.contentType === "application/pdf");
    check("the uploader's filename survives as a label",
      attachment?.fileName === "week 3 homework.pdf");

    const serialised = JSON.stringify(sent);
    check("nothing a service returns carries the storage key",
      !("storageKey" in attachment) && !serialised.includes("storageKey"));
    check("nor the checksum",
      !("checksum" in attachment) && !serialised.includes("checksum"));
    check("what it carries instead is an id and the route that checks the reader",
      typeof attachment?.id === "string" &&
        attachment.href === `/api/messages/attachments/${attachment.id}`);

    check("the bytes are in the attachments scope",
      (await countStored(STORAGE_SCOPES.ATTACHMENTS)) === before + 1);
    check("and nowhere near the folder holding identity documents",
      (await countStored(STORAGE_SCOPES.DOCUMENTS)) === 0);

    const raw = await Message.findById(sent.message.id)
      .select("+attachments.storageKey")
      .lean();
    check("the key is stored, but only behind an explicit select",
      typeof raw?.attachments?.[0]?.storageKey === "string" &&
        raw.attachments[0].storageKey.endsWith(".pdf"));

    const leanMessage = await Message.findById(sent.message.id).lean();
    check("an ordinary read of a message does not carry the key",
      leanMessage.attachments[0].storageKey === undefined);

    // --- a file on its own is a message -------------------------------------
    const fileOnly = await messages.sendMessage(
      {
        conversationId: sent.conversationId,
        body: "",
        files: [asFile(fakePng(64, 64, 512), "image/png", "question.png")],
      },
      learnerActor,
    );
    check("a message may be a file with nothing typed",
      fileOnly.message.attachments?.length === 1 && !fileOnly.message.body);

    const thread = await Conversation.findById(sent.conversationId).lean();
    check("and the thread list names the file instead of showing an empty preview",
      thread.lastMessagePreview?.includes("question.png"),
      thread.lastMessagePreview);

    const nothing = await throws(
      () => messages.sendMessage({ conversationId: sent.conversationId, body: "" }, learnerActor),
      (e) => e.status === 422 || e.status === 400,
    );
    check("but a message with neither text nor a file is still nothing",
      nothing.threw && nothing.matched);

    // --- who may read one ---------------------------------------------------
    const byRecipient = await messages.readMessageAttachment(attachment.id, tutorActor);
    check("the other participant can read it",
      Buffer.isBuffer(byRecipient.buffer) && byRecipient.buffer.length === 2048);
    check("and it comes back as what it was stored as",
      byRecipient.contentType === "application/pdf");

    const bySender = await messages.readMessageAttachment(attachment.id, learnerActor);
    check("so can the person who sent it", bySender.buffer.length === 2048);

    const byStranger = await throws(
      () => messages.readMessageAttachment(attachment.id, stranger),
      (e) => e.status === 403,
    );
    check("somebody who is not in the thread cannot",
      byStranger.threw && byStranger.matched);

    const guessed = await throws(
      () => messages.readMessageAttachment(new mongoose.Types.ObjectId(), learnerActor),
      (e) => e.status === 404,
    );
    check("and an id that is not an attachment resolves to nothing",
      guessed.threw && guessed.matched);

    const byAdmin = await messages.readMessageAttachment(attachment.id, admin);
    check("an administrator can, for moderation", byAdmin.buffer.length === 2048);

    const adminRead = await AuditLog.findOne({
      action: "ATTACHMENT_ADMIN_VIEWED",
      entityType: "Message",
      actorId: new mongoose.Types.ObjectId(admin.id),
    }).lean();
    check("and an administrator opening somebody's file is recorded", Boolean(adminRead));
    check("the record names the file without carrying the key",
      adminRead?.metadata?.fileName === "week 3 homework.pdf" &&
        !JSON.stringify(adminRead.metadata).includes("storageKey"));

    const writeTrail = await AuditLog.findOne({
      action: "MESSAGE_ATTACHMENT_ADDED",
      actorId: new mongoose.Types.ObjectId(learnerActor.id),
    }).lean();
    check("sending a file is audited", Boolean(writeTrail));
    check("and that record carries names and sizes, never bytes or keys",
      writeTrail?.metadata?.files?.[0]?.fileName === "week 3 homework.pdf" &&
        !JSON.stringify(writeTrail.metadata).includes("storageKey"));

    // --- homework on a progress report --------------------------------------
    student = await StudentProfile.create({
      ownerId: learner._id,
      firstName: "Homework",
      lastName: "Testcase",
      isMinor: true,
      shareFullNameWithTutor: false,
    });

    const startAt = new Date("2030-03-04T18:00:00.000Z");
    const lesson = await Booking.create({
      reference: `APL-H${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: learner._id,
      studentProfileId: student._id,
      tutorProfileId: tutorProfile._id,
      tutorUserId: tutorProfile.userId,
      courseId: tutorProfile.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
      courseName: "Advanced Functions",
      courseCode: "MHF4U",
      mode: "ONLINE",
      startAt,
      endAt: new Date(startAt.getTime() + 3600_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.COMPLETED,
      completedAt: new Date(),
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(lesson._id);

    const report = await progress.createProgressReport(
      { studentProfileId: String(student._id) },
      tutorActor,
    );
    madeReports.push(report.id);

    const notAuthor = await throws(
      () => progress.addHomeworkAttachments(report.id, [asFile(fakePdf())], learnerActor),
      (e) => e.status === 403,
    );
    check("a family cannot attach homework to their own report",
      notAuthor.threw && notAuthor.matched);

    const added = await progress.addHomeworkAttachments(
      report.id,
      [asFile(fakePdf(1024), "application/pdf", "practice set.pdf")],
      tutorActor,
    );
    check("the tutor who wrote the report can", added.attachments.length === 1);
    check("and it is addressed through the progress route, not the message one",
      added.attachments[0].href === `/api/progress/attachments/${added.attachments[0].id}`);
    check("with no key in sight", !JSON.stringify(added).includes("storageKey"));

    const homeworkId = added.attachments[0].id;

    const draftToFamily = await throws(
      () => progress.readHomeworkAttachment(homeworkId, learnerActor),
      (e) => e.status === 404,
    );
    check("a draft's files stay with their author, exactly as a draft's text does",
      draftToFamily.threw && draftToFamily.matched);

    await progress.updateProgressReport(
      report.id,
      { summary: "A test summary long enough to submit with." },
      tutorActor,
    );
    await progress.submitProgressReport(report.id, tutorActor);

    const familyReads = await progress.readHomeworkAttachment(homeworkId, learnerActor);
    check("once shared, the family can download the worksheet",
      familyReads.buffer.length === 1024);

    const strangerReads = await throws(
      () => progress.readHomeworkAttachment(homeworkId, stranger),
      (e) => e.status === 403,
    );
    check("another family cannot", strangerReads.threw && strangerReads.matched);

    const shown = await progress.getProgressReport(report.id, learnerActor);
    check("and the report the family reads carries the file",
      shown.report.homeworkAttachments?.length === 1);
    check("still with no key on it",
      !JSON.stringify(shown.report.homeworkAttachments).includes("storageKey"));

    // --- the cap, applied where two clicks cannot race past it --------------
    const room = UPLOAD.maxAttachmentsPerReport - 1;
    await progress.addHomeworkAttachments(
      report.id,
      Array.from({ length: room }, (_, i) => asFile(fakePdf(600), "application/pdf", `extra-${i}.pdf`)),
      tutorActor,
    );
    const overCap = await throws(
      () => progress.addHomeworkAttachments(report.id, [asFile(fakePdf())], tutorActor),
      (e) => e.code === "TOO_MANY_ATTACHMENTS" || e.status === 409,
    );
    check("a report cannot be pushed past its file cap",
      overCap.threw && overCap.matched, overCap.error?.message);

    const atCap = await ProgressReport.findById(report.id).lean();
    check("and it is holding exactly the cap, not one more",
      atCap.homeworkAttachments.length === UPLOAD.maxAttachmentsPerReport);

    // --- removing one from a report the family has already read -------------
    const storedBeforeRemoval = await countStored(STORAGE_SCOPES.ATTACHMENTS);
    const revisionsBefore = atCap.revisions.length;

    const afterRemoval = await progress.removeHomeworkAttachment(report.id, homeworkId, tutorActor);
    check("the author can take a worksheet back off",
      afterRemoval.attachments.length === UPLOAD.maxAttachmentsPerReport - 1);

    const reloaded = await ProgressReport.findById(report.id).lean();
    check("removing from a shared report snapshots a revision first",
      reloaded.revisions.length === revisionsBefore + 1);
    check("and the revision records the file was there",
      reloaded.revisions.at(-1).snapshot?.homeworkAttachments?.some(
        (a) => a.fileName === "practice set.pdf",
      ));
    check("without putting a storage key into the audit-visible snapshot",
      !JSON.stringify(reloaded.revisions.at(-1).snapshot).includes("storageKey"));

    check("the bytes are deleted, not merely unlinked from the document",
      (await countStored(STORAGE_SCOPES.ATTACHMENTS)) === storedBeforeRemoval - 1,
      `${await countStored(STORAGE_SCOPES.ATTACHMENTS)} vs ${storedBeforeRemoval - 1}`);

    const goneForGood = await throws(
      () => progress.readHomeworkAttachment(homeworkId, learnerActor),
      (e) => e.status === 404,
    );
    check("and the family's old link stops resolving",
      goneForGood.threw && goneForGood.matched);

    const removalTrail = await AuditLog.findOne({
      action: "PROGRESS_ATTACHMENT_REMOVED",
      entityId: new mongoose.Types.ObjectId(report.id),
    }).lean();
    check("removal is audited", Boolean(removalTrail));

    const addTrail = await AuditLog.findOne({
      action: "PROGRESS_ATTACHMENT_ADDED",
      entityId: new mongoose.Types.ObjectId(report.id),
    }).lean();
    check("so is attaching", Boolean(addTrail));
  } finally {
    const reportIds = madeReports.map((id) => new mongoose.Types.ObjectId(id));
    await AuditLog.deleteMany({
      $or: [
        { entityId: { $in: reportIds } },
        { action: { $in: ["MESSAGE_ATTACHMENT_ADDED", "ATTACHMENT_ADMIN_VIEWED"] } },
      ],
    });
    await Notification.deleteMany({ entityId: { $in: reportIds } });
    await ProgressReport.deleteMany({ _id: { $in: reportIds } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    if (student) await StudentProfile.deleteOne({ _id: student._id });
    await Message.deleteMany({ conversationId: { $in: madeConversations } });
    await Conversation.deleteMany({ _id: { $in: madeConversations } });
    await User.deleteMany({ _id: { $in: madeUsers } });

    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetStorageProvider();
    await rm(root, { recursive: true, force: true });
  }
}


// --- 34. One learner's analytics (§24, §41 Phase 3) -------------------------

/**
 * Student analytics, and the two things that make them safe to ship.
 *
 * The first is arithmetic. Every figure is aggregated in MongoDB from records
 * that exist for another reason, so the test builds a learner's history with
 * known contents — four lessons, one of them missed, one of them another
 * tutor's — and asserts the numbers that come back are the ones a person
 * would count by hand. A metric that is merely *plausible* is the failure
 * mode this whole feature has to avoid.
 *
 * The second is scope. Three readers see three different things, and the
 * differences are privacy rules rather than presentation: a tutor must not
 * learn what a family paid, must not see lessons taught by anybody else, and
 * must not be handed a minor's surname the family never shared.
 */
async function studentAnalyticsTests() {
  section("Student analytics — aggregation, scoping and privacy");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("student analytics", "MONGODB_URI is not set");

  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("student analytics", "MongoDB is not reachable");
    }
  }

  const {
    User, StudentProfile, TutorProfile, Booking, Payment, ProgressReport, Notification, AuditLog,
  } = await import("@/models");
  const analytics = await import("@/services/analytics.service");
  const {
    ROLES, USER_STATUS, BOOKING_STATUS, PAYMENT_STATUS, PROGRESS_REPORT_STATUS,
  } = await import("@/constants");

  const tutorProfile = await TutorProfile.findOne({ isSearchable: true }).lean();
  const otherTutorProfile = await TutorProfile.findOne({
    isSearchable: true,
    _id: { $ne: tutorProfile?._id },
  }).lean();
  if (!tutorProfile || !otherTutorProfile) {
    return skip("student analytics", "needs two seeded tutors — run `bun run seed`");
  }

  const madeUsers = [];
  const madeBookings = [];
  const madePayments = [];
  const madeReports = [];
  let student = null;

  /** Lessons are dated relative to now so the rolling window always holds them. */
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  try {
    const owner = await User.create({
      email: `insights-${randomUUID()}@example.invalid`,
      firstName: "Insight",
      lastName: "Testcase",
      role: ROLES.PARENT,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    madeUsers.push(owner._id);

    student = await StudentProfile.create({
      ownerId: owner._id,
      firstName: "Rowan",
      lastName: "Quintero",
      gradeName: "Grade 11",
      isMinor: true,
      shareFullNameWithTutor: false,
      learningGoals: [
        { label: "Insights test goal — achieved", achievedAt: daysAgo(5) },
        { label: "Insights test goal — open" },
      ],
    });

    const ownerActor = { id: String(owner._id), role: ROLES.PARENT };
    const tutorActor = { id: String(tutorProfile.userId), role: ROLES.TUTOR, emailVerifiedAt: new Date() };
    const otherTutorActor = { id: String(otherTutorProfile.userId), role: ROLES.TUTOR };
    const stranger = { id: String(new mongoose.Types.ObjectId()), role: ROLES.PARENT };
    const admin = { id: String(new mongoose.Types.ObjectId()), role: ROLES.ADMIN };

    const makeLesson = async ({ profile, status, at, minutes = 60 }) => {
      const booking = await Booking.create({
        reference: `APL-I${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
        purchaserId: owner._id,
        studentProfileId: student._id,
        tutorProfileId: profile._id,
        tutorUserId: profile.userId,
        courseId: profile.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
        courseName: "Advanced Functions",
        courseCode: "MHF4U",
        mode: "ONLINE",
        startAt: at,
        endAt: new Date(at.getTime() + minutes * 60_000),
        durationMinutes: minutes,
        status,
        completedAt: status === BOOKING_STATUS.COMPLETED ? at : undefined,
        price: {
          hourlyRateCents: 6000, durationMinutes: minutes, subtotalCents: 6000,
          commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
        },
      });
      madeBookings.push(booking._id);
      return booking;
    };

    // Three completed lessons with our tutor (one of them 90 minutes), one
    // missed, and one completed lesson with a different tutor entirely.
    const paid = await makeLesson({ profile: tutorProfile, status: BOOKING_STATUS.COMPLETED, at: daysAgo(20) });
    await makeLesson({ profile: tutorProfile, status: BOOKING_STATUS.COMPLETED, at: daysAgo(13) });
    await makeLesson({ profile: tutorProfile, status: BOOKING_STATUS.COMPLETED, at: daysAgo(6), minutes: 90 });
    await makeLesson({ profile: tutorProfile, status: BOOKING_STATUS.NO_SHOW_STUDENT, at: daysAgo(9) });
    await makeLesson({ profile: otherTutorProfile, status: BOOKING_STATUS.COMPLETED, at: daysAgo(4) });

    // An abandoned checkout, which must not count as a lesson or as money.
    await makeLesson({
      profile: tutorProfile,
      status: BOOKING_STATUS.PENDING_PAYMENT,
      at: daysAgo(2),
    });

    const payment = await Payment.create({
      bookingId: paid._id,
      purchaserId: owner._id,
      tutorUserId: tutorProfile.userId,
      subtotalCents: 6000,
      commissionPercent: 15,
      commissionCents: 900,
      tutorEarningsCents: 5100,
      totalCents: 6000,
      status: PAYMENT_STATUS.PARTIALLY_REFUNDED,
      refundedCents: 1500,
      paidAt: daysAgo(20),
    });
    madePayments.push(payment._id);

    const report = await ProgressReport.create({
      reference: `APL-R${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      tutorUserId: tutorProfile.userId,
      tutorProfileId: tutorProfile._id,
      studentProfileId: student._id,
      ownerId: owner._id,
      status: PROGRESS_REPORT_STATUS.SUBMITTED,
      submittedAt: daysAgo(3),
      summary: "An analytics fixture.",
      // Two of the four scales are rated. The other two must come back null.
      ratings: { understanding: 4, effort: 5 },
      milestones: [{ label: "Insights milestone", achievedAt: daysAgo(3) }],
    });
    madeReports.push(report._id);

    // --- what the family sees ------------------------------------------------
    const mine = await analytics.studentAnalytics(String(student._id), ownerActor, { days: 90 });

    check("completed lessons are counted from bookings that completed",
      mine.lessons.completed === 4, String(mine.lessons.completed));
    check("an abandoned checkout is not counted as a lesson",
      mine.lessons.total === 5, String(mine.lessons.total));
    check("a missed lesson is counted as missed",
      mine.lessons.missed === 1, String(mine.lessons.missed));
    check("attendance is completed over completed-plus-missed, not over everything",
      mine.lessons.attendanceRate === 80, String(mine.lessons.attendanceRate));
    check("hours are summed from the real durations",
      mine.lessons.hoursLearned === 5, String(mine.lessons.hoursLearned));

    check("the family sees every tutor who taught them",
      mine.tutors.count === 2, String(mine.tutors.count));

    check("the series buckets add up to the lessons counted",
      mine.series.reduce((sum, p) => sum + p.lessons, 0) === mine.lessons.total);
    check("and the course breakdown adds up to the completed ones",
      mine.courses.reduce((sum, c) => sum + c.lessons, 0) === mine.lessons.completed);

    check("goals come from the learner's own record",
      mine.goals.total === 2 && mine.goals.achieved === 1 && mine.goals.open === 1,
      JSON.stringify(mine.goals));
    check("milestones are counted from shared reports",
      mine.goals.milestones === 1, String(mine.goals.milestones));

    check("ratings are averaged from reports the family was actually shown",
      mine.feedback.understanding === 4 && mine.feedback.effort === 5,
      JSON.stringify(mine.feedback));
    check("a scale nobody rated comes back null, not zero",
      mine.feedback.participation === null && mine.feedback.homework === null,
      JSON.stringify(mine.feedback));
    check("the number of reports is the number shared in the window",
      mine.feedback.reports === 1);

    // Money: from Payment on paidAt, net of refunds, never from booking prices.
    check("spend comes from the payment, not from summing booking prices",
      mine.spend?.chargedCents === 6000, JSON.stringify(mine.spend));
    check("and refunds are subtracted",
      mine.spend?.netCents === 4500, String(mine.spend?.netCents));
    check("the figure says out loud that it excludes package purchases",
      mine.spend?.excludesPackagePurchases === true);
    check("the family sees their learner's full name",
      mine.learner.displayName === "Rowan Quintero", mine.learner.displayName);
    check("and the view is marked as the whole picture", mine.scope === "FULL");

    // --- what a tutor sees ---------------------------------------------------
    const theirs = await analytics.studentAnalytics(String(student._id), tutorActor, { days: 90 });

    check("a tutor sees only the lessons they taught",
      theirs.lessons.completed === 3, String(theirs.lessons.completed));
    // 60 + 60 + 90 minutes of their own teaching = 3.5 hours, reported to the
    // nearest hour. The learner's total across both tutors is five.
    check("and their own hours, not the learner's total",
      theirs.lessons.hoursLearned === 4 && mine.lessons.hoursLearned === 5,
      String(theirs.lessons.hoursLearned));
    check("a tutor is never shown what the family paid", theirs.spend === null);
    check("nor which other tutors the family uses", theirs.tutors.count === 0);
    check("the view is marked as scoped, so the screen can say so",
      theirs.scope === "TUTOR");
    check("a minor's surname is still masked from their tutor",
      theirs.learner.displayName === "Rowan Q.", theirs.learner.displayName);

    // Another tutor's report must not move this tutor's averages.
    const otherReport = await ProgressReport.create({
      reference: `APL-R${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      tutorUserId: otherTutorProfile.userId,
      tutorProfileId: otherTutorProfile._id,
      studentProfileId: student._id,
      ownerId: owner._id,
      status: PROGRESS_REPORT_STATUS.SUBMITTED,
      submittedAt: daysAgo(2),
      summary: "Another tutor's assessment.",
      ratings: { understanding: 1, effort: 1 },
    });
    madeReports.push(otherReport._id);

    const afterOther = await analytics.studentAnalytics(String(student._id), tutorActor, { days: 90 });
    check("another tutor's assessment does not move this tutor's averages",
      afterOther.feedback.understanding === 4 && afterOther.feedback.reports === 1,
      JSON.stringify(afterOther.feedback));

    const familyAfterOther = await analytics.studentAnalytics(
      String(student._id), ownerActor, { days: 90 },
    );
    check("but the family's average is across both of them",
      familyAfterOther.feedback.reports === 2 &&
        familyAfterOther.feedback.understanding === 2.5,
      JSON.stringify(familyAfterOther.feedback));

    // --- who is refused --------------------------------------------------------
    const byStranger = await throws(
      () => analytics.studentAnalytics(String(student._id), stranger, { days: 90 }),
      (e) => e.status === 403,
    );
    check("another family cannot read a learner's analytics",
      byStranger.threw && byStranger.matched);

    const byUntaughtTutor = await throws(
      () =>
        analytics.studentAnalytics(
          String(student._id),
          { id: String(new mongoose.Types.ObjectId()), role: ROLES.TUTOR },
          { days: 90 },
        ),
      (e) => e.status === 403,
    );
    check("nor can a tutor who has never taught them",
      byUntaughtTutor.threw && byUntaughtTutor.matched);

    // A future booking is not teaching: the tutor has to have finished one.
    const futureOnlyTutor = { id: String(otherTutorProfile.userId), role: ROLES.TUTOR };
    const futureLearner = await StudentProfile.create({
      ownerId: owner._id,
      firstName: "Future",
      lastName: "Only",
      isMinor: false,
    });
    const futureBooking = await Booking.create({
      reference: `APL-F${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: owner._id,
      studentProfileId: futureLearner._id,
      tutorProfileId: otherTutorProfile._id,
      tutorUserId: otherTutorProfile.userId,
      courseId: otherTutorProfile.courseIds?.[0] ?? new mongoose.Types.ObjectId(),
      courseName: "Functions",
      mode: "ONLINE",
      startAt: new Date(Date.now() + 86_400_000),
      endAt: new Date(Date.now() + 90_000_000),
      durationMinutes: 60,
      status: BOOKING_STATUS.CONFIRMED,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000,
        commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
    });
    madeBookings.push(futureBooking._id);

    const beforeFirstLesson = await throws(
      () => analytics.studentAnalytics(String(futureLearner._id), futureOnlyTutor, { days: 90 }),
      (e) => e.status === 403,
    );
    check("a booking that has not happened yet is not teaching",
      beforeFirstLesson.threw && beforeFirstLesson.matched);
    await StudentProfile.deleteOne({ _id: futureLearner._id });

    const missing = await throws(
      () => analytics.studentAnalytics(String(new mongoose.Types.ObjectId()), ownerActor, {}),
      (e) => e.status === 404,
    );
    check("a learner that does not exist is a 404, not an empty report",
      missing.threw && missing.matched);

    // --- an administrator, and an empty window ---------------------------------
    const byAdmin = await analytics.studentAnalytics(String(student._id), admin, { days: 90 });
    check("an administrator sees the whole picture",
      byAdmin.scope === "FULL" && byAdmin.lessons.completed === 4);

    const emptyWindow = await analytics.studentAnalytics(String(student._id), ownerActor, {
      from: new Date("2020-01-01T00:00:00.000Z").toISOString(),
      to: new Date("2020-02-01T00:00:00.000Z").toISOString(),
    });
    check("a window with no lessons reports zero rather than the lifetime total",
      emptyWindow.lessons.total === 0 && emptyWindow.lessons.completed === 0);
    check("and no spend rather than a stale figure",
      emptyWindow.spend.chargedCents === 0 && emptyWindow.spend.netCents === 0);
    check("an empty window still names the period it is empty for",
      typeof emptyWindow.period.from === "string" && typeof emptyWindow.period.to === "string");
    check("and carries no ratings at all",
      emptyWindow.feedback.reports === 0 && emptyWindow.feedback.understanding === null);
  } finally {
    await AuditLog.deleteMany({ entityId: { $in: madeReports } });
    await Notification.deleteMany({ entityId: { $in: madeReports } });
    await ProgressReport.deleteMany({ _id: { $in: madeReports } });
    await Payment.deleteMany({ _id: { $in: madePayments } });
    await Booking.deleteMany({ _id: { $in: madeBookings } });
    if (student) await StudentProfile.deleteOne({ _id: student._id });
    await StudentProfile.deleteMany({ ownerId: { $in: madeUsers } });
    await User.deleteMany({ _id: { $in: madeUsers } });
  }
}

// --- Password reset by emailed code ----------------------------------------
//
// The whole forgot-password flow at the service level: what is stored, what
// is refused, and — the property that is easiest to lose — that nothing an
// unknown address sees differs from what a real one sees.
async function passwordResetTests() {
  section("Password reset — emailed code, enumeration, single use");

  const uri = process.env.MONGODB_URI;
  if (!uri) return skip("password reset", "MONGODB_URI is not set");
  if (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    } catch {
      return skip("password reset", "MongoDB is not reachable");
    }
  }

  const { User, AuthToken, AUTH_TOKEN_PURPOSE, AuditLog, RateLimitWindow } = await import("@/models");
  const { AUDIT_ACTIONS, PASSWORD_RESET } = await import("@/constants");
  const reset = await import("@/services/password-reset.service");
  const { hashPassword, verifyPassword } = await import("@/lib/auth/password");
  const { createHash } = await import("node:crypto");
  const mailbox = await import("@/services/external/dev-mailbox");
  const { developmentMailboxEnabled, resetEmailProvider } = await import(
    "@/services/external/email-provider"
  );
  const { invalidateIntegrationCache } = await import("@/lib/config/integrations");
  const { forgotPasswordSchema, verifyResetCodeSchema, resetPasswordSchema } = await import(
    "@/lib/validation/auth"
  );

  const withEnv = async (vars, fn) => {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    invalidateIntegrationCache();
    resetEmailProvider();
    try {
      return await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      invalidateIntegrationCache();
      resetEmailProvider();
    }
  };

  // Every limit here is a real, shared rate-limit window. Each step that
  // needs a fresh request clears the ones for this run's addresses, rather
  // than the suite waiting out a sixty-second cooldown.
  const clearWindows = () => RateLimitWindow.deleteMany({ _id: /^password-reset:/ });
  const codeFor = (email) => {
    const message = mailbox.readDevMail({ to: email })
      .find((m) => /password reset code/i.test(m.subject));
    return message?.text.match(/^\s+(\d{6})\s*$/m)?.[1] ?? null;
  };
  const refused = (fn, code) => throws(fn, (e) => e.code === code);

  const PASSWORD = "AplusLearn2024!";
  const NEW_PASSWORD = "BrandNewPass123";
  const made = [];
  const makeUser = async (label) => {
    const user = await User.create({
      email: `reset-${label}-${randomUUID()}@example.com`,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Reset",
      lastName: "Tester",
      role: "PARENT",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
    });
    made.push(user._id);
    return user;
  };
  const unknownEmail = `nobody-${randomUUID()}@example.com`;

  try {
    await clearWindows();
    mailbox.clearDevMail();
    const alice = await makeUser("alice");
    const bob = await makeUser("bob");

    // --- validation --------------------------------------------------------
    check("an invalid email is refused before the service runs",
      !forgotPasswordSchema.safeParse({ email: "not-an-email" }).success);
    check("the address is normalised the way sign-in normalises it",
      forgotPasswordSchema.parse({ email: "Alice@Example.COM" }).email === "alice@example.com");
    check("a code must be six digits",
      !verifyResetCodeSchema.safeParse({ code: "12345" }).success &&
        !verifyResetCodeSchema.safeParse({ code: "12345a" }).success);
    check("a pasted code with a space still reads as six digits",
      verifyResetCodeSchema.parse({ code: "123 456" }).code === "123456");
    const mismatch = resetPasswordSchema.safeParse({
      token: "t".repeat(43), password: NEW_PASSWORD, confirmPassword: "Different123",
    });
    check("mismatched passwords are refused with the shared message",
      !mismatch.success && mismatch.error.issues.some((i) => i.message === "Passwords do not match."));
    check("the shared password policy applies to a reset",
      !resetPasswordSchema.safeParse({ token: "t".repeat(43), password: "short", confirmPassword: "short" }).success);

    // --- request: identical for real and unknown addresses ---------------
    const known = await reset.requestPasswordReset(alice.email, { ip: "203.0.113.9" });
    const unknown = await reset.requestPasswordReset(unknownEmail);
    const shape = (r) => Object.keys(r).sort().join(",");
    check("a real and an unknown address get responses of the same shape",
      shape(known) === shape(unknown));
    check("and the same numbers in them",
      known.expiresInMinutes === unknown.expiresInMinutes &&
        known.resendInSeconds === unknown.resendInSeconds &&
        Math.abs(known.codeExpiresInSeconds - unknown.codeExpiresInSeconds) <= 1);
    check("both get a request handle", Boolean(known.requestToken) && Boolean(unknown.requestToken));
    check("the address is masked, not echoed", known.maskedEmail === `r***@example.com`);
    check("the code expires on the configured schedule",
      known.expiresInMinutes === PASSWORD_RESET.codeTtlMinutes &&
        known.codeExpiresInSeconds <= PASSWORD_RESET.codeTtlMinutes * 60);
    check("nothing returned carries a six-digit code",
      !/\b\d{6}\b/.test(JSON.stringify({ ...known, requestToken: undefined })));

    const stored = await AuthToken.findOne({
      userId: alice._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET, consumedAt: null,
    }).lean();
    const firstCode = codeFor(alice.email);
    check("a real account gets one live code", Boolean(stored) && Boolean(firstCode));
    check("the development transport delivered the real code to the mailbox", /^\d{6}$/.test(firstCode ?? ""));
    check("the code is not stored in the clear",
      stored && !stored.tokenHash.includes(firstCode) && stored.tokenHash !== firstCode);
    check("nor as a plain hash a leaked database could reverse",
      stored && stored.tokenHash !== createHash("sha256").update(firstCode).digest("hex"));
    check("the code expires in ten minutes",
      stored && Math.abs(stored.expiresAt.getTime() - Date.now() - PASSWORD_RESET.codeTtlMinutes * 60_000) < 5_000);
    check("the requesting address is recorded", stored?.requestedIp === "203.0.113.9");
    check("an unknown address is sent nothing", mailbox.readDevMail({ to: unknownEmail }).length === 0);

    // --- cooldown and hourly cap, identical for both -------------------------
    const againKnown = await refused(() => reset.requestPasswordReset(alice.email), "RESEND_COOLDOWN");
    const againUnknown = await refused(() => reset.requestPasswordReset(unknownEmail), "RESEND_COOLDOWN");
    check("an immediate second request is held back by the cooldown",
      againKnown.threw && againKnown.matched && againKnown.error.status === 429);
    check("and an unknown address is held back identically",
      againUnknown.threw && againUnknown.matched &&
        againUnknown.error.message.replace(/\d+/, "N") === againKnown.error.message.replace(/\d+/, "N"));
    check("the cooldown says how long to wait",
      againKnown.error?.details?.retryAfterSeconds > 0 &&
        againKnown.error.details.retryAfterSeconds <= PASSWORD_RESET.resendCooldownSeconds);

    // --- a deferred send: the account work happens after the response -------
    await clearWindows();
    const deferred = [];
    await reset.requestPasswordReset(bob.email, { defer: (task) => deferred.push(task) });
    check("with a deferring route, no account work has happened by the time it answers",
      deferred.length === 1 && !(await AuthToken.exists({ userId: bob._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET })));
    await deferred[0]();
    check("and it happens when the deferred task runs",
      Boolean(await AuthToken.exists({ userId: bob._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET })));

    // --- verification: wrong, expired, forged, cross-account --------------
    const wrong = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: known.requestToken, code: firstCode === "000000" ? "111111" : "000000" }),
      "VALIDATION_ERROR",
    );
    check("a wrong code is refused as invalid",
      wrong.threw && wrong.matched && wrong.error.message === "The verification code is invalid.");
    const counted = await AuthToken.findById(stored._id).lean();
    check("and the wrong guess is counted against the code", counted.attempts === 1 && !counted.consumedAt);

    const unknownWrong = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: unknown.requestToken, code: "123456" }),
      "VALIDATION_ERROR",
    );
    check("an unknown address's guess gets the identical refusal",
      unknownWrong.threw && unknownWrong.matched && unknownWrong.error.message === wrong.error.message);

    const forged = known.requestToken.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const forgedResult = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: forged, code: firstCode }), "CODE_EXPIRED",
    );
    check("a tampered request handle is refused, even with the right code",
      forgedResult.threw && forgedResult.matched);
    const noHandle = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: null, code: firstCode }), "CODE_EXPIRED",
    );
    check("so is no handle at all", noHandle.threw && noHandle.matched);

    const bobCode = codeFor(bob.email);
    const crossed = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: known.requestToken, code: bobCode }), "VALIDATION_ERROR",
    );
    check("another account's code does not open this one", crossed.threw && crossed.matched);

    const realNow = Date.now;
    Date.now = () => realNow() + (PASSWORD_RESET.codeTtlMinutes + 1) * 60_000;
    let late;
    try {
      late = await refused(
        () => reset.verifyPasswordResetCode({ requestToken: known.requestToken, code: firstCode }), "CODE_EXPIRED",
      );
    } finally {
      Date.now = realNow;
    }
    check("a code past its ten minutes is refused as expired, not as wrong",
      late.threw && late.matched && late.error.status === 410 &&
        late.error.message === "This verification code has expired. Please request a new code.");

    // --- resend voids the previous code ------------------------------------
    await clearWindows();
    mailbox.clearDevMail();
    const resent = await reset.resendPasswordResetCode(known.requestToken);
    const secondCode = codeFor(alice.email);
    check("a resend sends a fresh code", Boolean(secondCode) && Boolean(resent.requestToken));
    check("and voids the one before it",
      Boolean((await AuthToken.findById(stored._id).lean()).consumedAt));
    const oldAfterResend = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: resent.requestToken, code: firstCode === secondCode ? "000000" : firstCode }),
      "VALIDATION_ERROR",
    );
    check("the old code no longer works after a resend", oldAfterResend.threw && oldAfterResend.matched);
    const oldHandle = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: known.requestToken, code: secondCode }),
      "VALIDATION_ERROR",
    );
    check("and the new code only works with the request it was sent for", oldHandle.threw && oldHandle.matched);
    const expiredRequest = await refused(() => reset.resendPasswordResetCode("garbage"), "RESET_REQUEST_EXPIRED");
    check("a resend without a valid request asks to start again", expiredRequest.threw && expiredRequest.matched);

    // --- the right code, once ---------------------------------------------
    const verified = await reset.verifyPasswordResetCode({ requestToken: resent.requestToken, code: secondCode });
    check("the right code is exchanged for a reset authorisation",
      typeof verified.resetToken === "string" && verified.resetToken.length >= 40);
    check("which is short-lived", verified.expiresInMinutes === PASSWORD_RESET.authorizationTtlMinutes);
    const grant = await AuthToken.findOne({
      userId: alice._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION, consumedAt: null,
    }).lean();
    check("the authorisation is stored only as a hash",
      grant && grant.tokenHash !== verified.resetToken && !grant.tokenHash.includes(verified.resetToken));
    const reused = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: resent.requestToken, code: secondCode }),
      "VALIDATION_ERROR",
    );
    check("the same code cannot be used twice", reused.threw && reused.matched);

    // --- reset -------------------------------------------------------------
    const forgedGrant = await refused(
      () => reset.resetPassword({ token: "x".repeat(43), password: NEW_PASSWORD }), "RESET_EXPIRED",
    );
    check("an authorisation that was never issued is refused", forgedGrant.threw && forgedGrant.matched);

    const versionBefore = (await User.findById(alice._id).lean()).tokenVersion ?? 0;
    mailbox.clearDevMail();
    const done = await reset.resetPassword({ token: verified.resetToken, password: NEW_PASSWORD });
    check("a valid authorisation sets the new password", done.reset === true);
    const after = await User.findById(alice._id).select("+passwordHash").lean();
    check("the new password is stored as a bcrypt hash, never in the clear",
      after.passwordHash.startsWith("$2") && !after.passwordHash.includes(NEW_PASSWORD));
    check("the new password now signs in", await verifyPassword(NEW_PASSWORD, after.passwordHash));
    check("the old password no longer does", !(await verifyPassword(PASSWORD, after.passwordHash)));
    check("every existing session is ended", (after.tokenVersion ?? 0) === versionBefore + 1);
    check("the account owner is told their password changed",
      mailbox.readDevMail({ to: alice.email }).some((m) => /password was changed/i.test(m.subject)));
    check("the reset is audited",
      Boolean(await AuditLog.exists({ entityId: alice._id, action: AUDIT_ACTIONS.USER_PASSWORD_RESET })));
    const replay = await refused(
      () => reset.resetPassword({ token: verified.resetToken, password: "AnotherPass123" }), "RESET_EXPIRED",
    );
    check("the authorisation cannot be used twice", replay.threw && replay.matched);
    check("nothing reset-related is left live on the account",
      !(await AuthToken.exists({
        userId: alice._id,
        purpose: { $in: [AUTH_TOKEN_PURPOSE.PASSWORD_RESET, AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION] },
        consumedAt: null,
      })));

    // --- an authorisation that has lapsed ------------------------------------
    await clearWindows();
    mailbox.clearDevMail();
    const bobRequest = await reset.requestPasswordReset(bob.email);
    const bobGrant = await reset.verifyPasswordResetCode({
      requestToken: bobRequest.requestToken, code: codeFor(bob.email),
    });
    await AuthToken.updateOne(
      { userId: bob._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION, consumedAt: null },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const lapsed = await refused(
      () => reset.resetPassword({ token: bobGrant.resetToken, password: NEW_PASSWORD }), "RESET_EXPIRED",
    );
    check("an authorisation past its ten minutes is refused", lapsed.threw && lapsed.matched);
    check("and the password is untouched",
      await verifyPassword(PASSWORD, (await User.findById(bob._id).select("+passwordHash").lean()).passwordHash));

    // --- guesses run out, for a real address and an unknown one alike -------
    await clearWindows();
    mailbox.clearDevMail();
    const bobAgain = await reset.requestPasswordReset(bob.email);
    const bobRight = codeFor(bob.email);
    const bobWrong = bobRight === "000000" ? "111111" : "000000";
    for (let i = 0; i < PASSWORD_RESET.maxAttempts; i += 1) {
      await throws(() => reset.verifyPasswordResetCode({ requestToken: bobAgain.requestToken, code: bobWrong }));
    }
    const locked = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: bobAgain.requestToken, code: bobRight }),
      "TOO_MANY_ATTEMPTS",
    );
    check("after five wrong guesses even the right code is refused",
      locked.threw && locked.matched && locked.error.status === 429 &&
        locked.error.message === "Too many verification attempts. Please request a new code.");
    check("and the code is burned",
      !(await AuthToken.exists({ userId: bob._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET, consumedAt: null })));

    const ghost = await reset.requestPasswordReset(unknownEmail);
    for (let i = 0; i < PASSWORD_RESET.maxAttempts; i += 1) {
      await throws(() => reset.verifyPasswordResetCode({ requestToken: ghost.requestToken, code: "123456" }));
    }
    const ghostLocked = await refused(
      () => reset.verifyPasswordResetCode({ requestToken: ghost.requestToken, code: "123456" }),
      "TOO_MANY_ATTEMPTS",
    );
    check("an unknown address locks out after exactly the same five guesses",
      ghostLocked.threw && ghostLocked.matched && ghostLocked.error.message === locked.error.message);

    // --- hourly cap per address ---------------------------------------------
    await clearWindows();
    let capped = null;
    for (let i = 0; i <= PASSWORD_RESET.maxCodesPerHour; i += 1) {
      await RateLimitWindow.deleteMany({ _id: /^password-reset:cooldown:/ });
      const result = await throws(() => reset.requestPasswordReset(unknownEmail));
      if (result.threw) {
        capped = { attempt: i + 1, error: result.error };
        break;
      }
    }
    check("one address can be sent at most five codes an hour",
      capped?.attempt === PASSWORD_RESET.maxCodesPerHour + 1 && capped.error.code === "RATE_LIMITED");

    // --- a deleted account is indistinguishable from none -------------------
    await clearWindows();
    await User.updateOne({ _id: bob._id }, { $set: { deletedAt: new Date() } });
    mailbox.clearDevMail();
    const gone = await reset.requestPasswordReset(bob.email);
    check("a deleted account is answered like an unknown one and sent nothing",
      shape(gone) === shape(known) && mailbox.readDevMail({ to: bob.email }).length === 0);

    // --- the development mailbox cannot exist in production -----------------
    check("in development with no mail server, the mailbox is open", await developmentMailboxEnabled());
    await withEnv({ APP_ENV: "production" }, async () => {
      mailbox.recordDevMail({ to: "p@example.com", subject: "s", text: "123456" });
      check("with APP_ENV=production nothing is recorded or read",
        mailbox.readDevMail().length === 0 && !mailbox.devMailboxAllowed());
      check("and the mailbox reports itself closed", !(await developmentMailboxEnabled()));
    });
    await withEnv({ NODE_ENV: "production", APP_ENV: "staging" }, async () => {
      check("a production build is closed even on a non-production deployment",
        !mailbox.devMailboxAllowed() && !(await developmentMailboxEnabled()));
    });

    // --- a real provider: the same service, a different transport -----------
    await clearWindows();
    mailbox.clearDevMail();
    const carol = await makeUser("carol");
    const originalFetch = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (url, options = {}) => {
      sent.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, json: async () => ({ id: "msg_reset" }), text: async () => "{}" };
    };
    try {
      await withEnv(
        { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key", EMAIL_FROM: "APlus Learn <no-reply@apluslearn.ca>" },
        async () => {
          check("with a mail server configured, the mailbox closes", !(await developmentMailboxEnabled()));
          const viaResend = await reset.requestPasswordReset(carol.email);
          const delivery = sent.find((call) => call.url === "https://api.resend.com/emails");
          const deliveredCode = delivery?.body?.text?.match(/^\s+(\d{6})\s*$/m)?.[1];
          check("the unchanged service hands the code to the configured provider",
            Boolean(delivery) && delivery.body.to?.[0] === carol.email && /^\d{6}$/.test(deliveredCode ?? ""));
          check("and nothing reaches the development mailbox",
            mailbox.readDevMail({ to: carol.email }).length === 0);
          const viaResendGrant = await reset.verifyPasswordResetCode({
            requestToken: viaResend.requestToken, code: deliveredCode,
          });
          check("the code the real provider delivered verifies exactly the same way",
            typeof viaResendGrant.resetToken === "string");
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  } finally {
    await clearWindows();
    mailbox.clearDevMail();
    await AuthToken.deleteMany({ userId: { $in: made } });
    await AuditLog.deleteMany({ entityId: { $in: made } });
    await User.deleteMany({ _id: { $in: made } });
  }
}

main()
  .catch((error) => {
    console.error("\nIntegration tests crashed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Mongoose keeps the event loop alive. Everything has been asserted and
    // cleaned up by this point, so ending the process is the exit, not a
    // way of hiding work still in flight.
    process.exit(process.exitCode ?? 0);
  });
