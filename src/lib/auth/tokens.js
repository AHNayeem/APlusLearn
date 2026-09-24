import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Email-verification and password-reset tokens.
 * The raw token goes in the emailed link; only its hash is persisted.
 */
export function createToken() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw) };
}

export function hashToken(raw) {
  return createHash("sha256").update(String(raw)).digest("hex");
}

export function tokensMatch(rawCandidate, storedHash) {
  const candidate = Buffer.from(hashToken(rawCandidate), "hex");
  const stored = Buffer.from(String(storedHash), "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/** Short, human-readable public reference, e.g. APL-7F3K2Q. */
export function publicReference(prefix = "APL") {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
  const bytes = randomBytes(6);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${prefix}-${out}`;
}
