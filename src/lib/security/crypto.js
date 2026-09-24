import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Encryption at rest for third-party credentials (§36, §41 Phase 2).
 *
 * OAuth refresh tokens are the one class of secret this application has to
 * *store* rather than merely verify: a calendar connection has to survive a
 * restart, and a refresh token is the thing that makes that possible. A
 * refresh token is also a standing key to somebody's calendar, so it is never
 * written in the clear.
 *
 * AES-256-GCM, with the key derived from `AUTH_SECRET` through HKDF under a
 * purpose-specific label. Deriving rather than reusing means the key that
 * encrypts a calendar token is not the key that signs a session, so one being
 * compromised does not hand over the other — and rotating `AUTH_SECRET`
 * invalidates both, which is the correct behaviour for a leaked secret.
 *
 * GCM rather than CBC because it authenticates: a stored ciphertext that has
 * been tampered with fails to decrypt instead of yielding attacker-chosen
 * plaintext.
 *
 * Stored form:  v1.<iv>.<authTag>.<ciphertext>, all base64url.
 * The version prefix is what makes a future algorithm change a migration
 * rather than a break.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96 bits, the size GCM is specified for
const KEY_BYTES = 32;

/** Cached per label — HKDF is cheap but not free, and this runs per token. */
const keyCache = new Map();

function keyFor(label) {
  const cached = keyCache.get(label);
  if (cached) return cached;

  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    // The same rule the session signer holds to: no secret, no cryptography.
    // Falling back to a fixed key would be worse than failing, because it
    // would look like it worked.
    throw new Error("AUTH_SECRET must be set (32+ characters) before secrets can be encrypted.");
  }

  const key = Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.from(label, "utf8"), KEY_BYTES),
  );
  keyCache.set(label, key);
  return key;
}

/**
 * Encrypt a secret for storage.
 *
 * @param {string} plaintext
 * @param {string} [label]  Key-separation purpose, e.g. "calendar-token".
 */
export function encryptSecret(plaintext, label = "aplus:secret") {
  if (plaintext == null || plaintext === "") return null;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFor(label), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join(".");
}

/**
 * Decrypt a stored secret.
 *
 * Returns null rather than throwing when the value cannot be read — a token
 * encrypted under a rotated `AUTH_SECRET` is simply gone, and the caller's
 * correct response is to ask the person to reconnect, not to crash.
 */
export function decryptSecret(stored, label = "aplus:secret") {
  if (!stored) return null;

  try {
    const [version, iv, tag, ciphertext] = String(stored).split(".");
    if (version !== VERSION || !iv || !tag || !ciphertext) return null;

    const decipher = createDecipheriv(ALGORITHM, keyFor(label), unb64(iv));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(ciphertext)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** True when a stored value is in the encrypted format this module writes. */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(`${VERSION}.`);
}

/**
 * A signed, self-describing state value for an OAuth round trip (§36).
 *
 * The state parameter comes back from the provider through the person's
 * browser, so it is authenticated rather than trusted: a callback that names
 * a different account, or one crafted from scratch, fails this check before
 * any token is exchanged. The timestamp bounds how long a captured redirect
 * stays useful.
 */
export function signState(payload, { label = "aplus:oauth-state", ttlSeconds = 900 } = {}) {
  const body = b64(
    Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })),
  );
  const signature = createHmac("sha256", keyFor(label)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** Verify and decode a state value. Returns null on anything suspicious. */
export function verifyState(state, { label = "aplus:oauth-state" } = {}) {
  if (!state || typeof state !== "string") return null;

  const [body, signature] = state.split(".");
  if (!body || !signature) return null;

  const expected = createHmac("sha256", keyFor(label)).update(body).digest("base64url");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64(body).toString("utf8"));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * A keyed digest, for a short secret that has to be stored and compared.
 *
 * A plain hash of a six-digit code is no protection at all — a million
 * candidates fall to a laptop in well under a second. Keying the digest under
 * `AUTH_SECRET` means a copy of the database alone recovers nothing, and the
 * label keeps this key apart from every other one derived from that secret.
 */
export function keyedDigest(value, label) {
  return createHmac("sha256", keyFor(label)).update(String(value)).digest("hex");
}

function b64(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function unb64(value) {
  return Buffer.from(value, "base64url");
}
