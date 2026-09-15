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
 * Password policy. Returned as a list so the UI can show every unmet rule at
 * once rather than one at a time.
 */
export function passwordIssues(password = "") {
  const issues = [];
  if (password.length < 10) issues.push("Use at least 10 characters");
  if (!/[a-z]/.test(password)) issues.push("Include a lowercase letter");
  if (!/[A-Z]/.test(password)) issues.push("Include an uppercase letter");
  if (!/[0-9]/.test(password)) issues.push("Include a number");
  return issues;
}

export function isStrongPassword(password) {
  return passwordIssues(password).length === 0;
}
