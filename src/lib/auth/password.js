import "server-only";
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

/** Passwords are only ever stored as a bcrypt hash (§9, §35). */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain, hash) {
  if (!hash) {
    // Constant-ish work for OAuth-only accounts so a missing hash does not
    // reveal, by timing, that the address exists without a password.
    await bcrypt.compare(plain, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/**
 * The policy lives in `./password-policy`, which has no imports at all, and
 * is re-exported here so a server caller still finds it where it expects to.
 *
 * The split is the point: the forms that show the rules as somebody types run
 * in the browser, and importing them from this module dragged `bcryptjs` into
 * the client bundle along with them.
 */
export { passwordIssues, isStrongPassword } from "./password-policy";
