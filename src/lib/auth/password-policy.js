/**
 * The password policy, and nothing else (§9).
 *
 * Deliberately its own module with no imports. The registration and
 * password-change forms show every unmet rule as the person types, which
 * means this runs in the browser — and the moment it lived beside
 * `hashPassword` it pulled `bcryptjs` into the client bundle with it. A
 * hashing library has no business in a browser: it is dead weight on every
 * page load and it advertises exactly how the server stores credentials.
 *
 * The rules here are the courtesy copy. `lib/validation/common.js` holds the
 * same rules as the schema the server actually enforces, and that one is the
 * control — a browser can always be skipped.
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
