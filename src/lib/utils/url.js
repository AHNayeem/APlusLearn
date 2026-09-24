/**
 * A destination that can only ever be inside this application (§36).
 *
 * Sign-in, registration and OAuth all carry a `next` parameter so somebody
 * who was sent to the login page lands back where they were. That parameter
 * is under the caller's control, so "does it start with a slash?" is not
 * enough on its own: a browser reads `//evil.example/x` and `/\evil.example/x`
 * as another *origin*, not as a path on this one, which turns a sign-in link
 * into an open redirect — the classic shape of a credential-phishing lure,
 * because the address bar shows this application right up until the moment it
 * does not.
 *
 * Pure, and free of imports, because both the server (the auth schemas) and
 * the browser (the registration form) have to agree on the answer.
 *
 * @returns {string|null} the path, or `fallback` if it is not ours.
 */
export function internalPath(value, fallback = null) {
  if (typeof value !== "string") return fallback;

  const path = value.trim();
  if (!path.startsWith("/")) return fallback;

  // `//host` and `/\host` are both another origin as far as a browser is
  // concerned, whatever they look like.
  if (/^\/[\\/]/.test(path)) return fallback;

  // A control character can be used to smuggle one of the above past a check
  // like this one; browsers strip tabs and newlines before parsing a URL.
  if (/[\u0000-\u001f\u007f]/.test(path)) return fallback;

  return path;
}
