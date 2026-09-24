import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { SESSION } from "@/constants/config";

/**
 * Stateless sessions: a signed JWT in an httpOnly cookie.
 *
 * The token carries `tokenVersion`, which is compared against the user record
 * on every authenticated request. Bumping the user's version (password reset,
 * forced logout, suspension) invalidates every issued token at once.
 */

const ISSUER = "apluslearn";
const AUDIENCE = "apluslearn:web";

function secretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be set to a random string of at least 32 characters. See .env.example.",
    );
  }
  return new TextEncoder().encode(secret);
}

function sessionLifetime(remember) {
  return remember ? SESSION.maxAgeSeconds : SESSION.transientMaxAgeSeconds;
}

export async function signSessionToken({ userId, role, tokenVersion, remember = true }) {
  return new SignJWT({ role, tv: tokenVersion ?? 0, rm: remember })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${sessionLifetime(remember)}s`)
    .sign(secretKey());
}

/** Returns the payload, or null for any invalid/expired token. */
export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return {
      userId: payload.sub,
      role: payload.role,
      tokenVersion: payload.tv ?? 0,
      // Tokens issued before the claim existed were all persistent.
      remember: payload.rm ?? true,
    };
  } catch {
    return null;
  }
}

/**
 * An unremembered session omits Max-Age, which makes it a browser-session
 * cookie; its token's own expiry is the backstop.
 */
function sessionCookieOptions(remember) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(remember ? { maxAge: SESSION.maxAgeSeconds } : {}),
  };
}

function sessionTokenFor(user, remember) {
  return signSessionToken({
    userId: user._id ?? user.id,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
    remember,
  });
}

/** `remember: false` is "Keep me signed in" unticked at sign-in. */
export async function createSessionCookie(user, { remember = true } = {}) {
  const token = await sessionTokenFor(user, remember);
  const store = await cookies();
  store.set(SESSION.cookieName, token, sessionCookieOptions(remember));
  return token;
}

/**
 * Reissue the current session for a changed user record (a password change
 * bumps tokenVersion), keeping the choice made at sign-in — an unremembered
 * session must not become a 14-day one because its owner changed a password.
 */
export async function reissueSessionCookie(user) {
  const current = await verifySessionToken(await readSessionToken());
  return createSessionCookie(user, { remember: current?.remember ?? true });
}

/**
 * The same session cookie, set on a response the caller built.
 *
 * For the social sign-in callback, which answers with a redirect: setting the
 * cookie on that response object is explicit about which response carries it,
 * rather than relying on the framework to merge `cookies()` into a redirect.
 */
export async function applySessionCookie(response, user) {
  response.cookies.set(SESSION.cookieName, await sessionTokenFor(user, true), sessionCookieOptions(true));
}

export async function destroySessionCookie() {
  const store = await cookies();
  store.delete(SESSION.cookieName);
}

/** Raw token from the request cookie, or null. */
export async function readSessionToken() {
  const store = await cookies();
  return store.get(SESSION.cookieName)?.value ?? null;
}

/**
 * One social sign-in attempt, held by the browser that started it (§9, §36).
 *
 * The value is the encrypted transaction `oauth-signin.service` builds — the
 * `state` the callback must echo, the `nonce` the ID token must carry, and
 * Google's PKCE verifier. The callback refuses any attempt whose `state` does
 * not match this cookie, which is what makes a sign-in link crafted by
 * somebody else (login CSRF) or a code intercepted in transit useless.
 *
 * Scoped to the OAuth routes, so it is never sent anywhere else, and consumed
 * by the callback whether the attempt succeeds or fails.
 *
 * Apple returns the person with a cross-site *POST* (`response_mode=form_post`
 * is mandatory when asking for a name or email), and a `SameSite=Lax` cookie
 * is not sent on one — so Apple's attempts use `SameSite=None`, which browsers
 * accept only with `Secure`. Google returns with a GET, which Lax allows.
 */
export const OAUTH_TRANSACTION_COOKIE = "aplus_oauth_tx";
const OAUTH_COOKIE_PATH = "/api/auth/oauth";

function oauthTransactionOptions({ crossSitePost }) {
  return crossSitePost
    ? { httpOnly: true, secure: true, sameSite: "none", path: OAUTH_COOKIE_PATH }
    : {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: OAUTH_COOKIE_PATH,
      };
}

export function setOAuthTransactionCookie(response, value, { crossSitePost = false, maxAge }) {
  response.cookies.set(OAUTH_TRANSACTION_COOKIE, value, {
    ...oauthTransactionOptions({ crossSitePost }),
    maxAge,
  });
}

export function readOAuthTransactionCookie(request) {
  return request.cookies.get(OAUTH_TRANSACTION_COOKIE)?.value ?? null;
}

/** One attempt, one use — cleared on success and on failure alike. */
export function clearOAuthTransactionCookie(response, { crossSitePost = false } = {}) {
  response.cookies.set(OAUTH_TRANSACTION_COOKIE, "", {
    ...oauthTransactionOptions({ crossSitePost }),
    maxAge: 0,
  });
}

/**
 * The browser's handle on a forgot-password request (§9, §36).
 *
 * A signed value naming the request and the address it was made for, issued
 * identically whether or not an account exists. Kept in an httpOnly cookie so
 * page script never holds it, and so a refreshed page can pick the flow up
 * where it was. It authorises nothing on its own: it is what a code is
 * checked *against*.
 */
const PASSWORD_RESET_COOKIE = "aplus_password_reset";

export async function setPasswordResetCookie(value, maxAgeSeconds) {
  const store = await cookies();
  store.set(PASSWORD_RESET_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export async function readPasswordResetCookie() {
  const store = await cookies();
  return store.get(PASSWORD_RESET_COOKIE)?.value ?? null;
}

export async function clearPasswordResetCookie() {
  const store = await cookies();
  store.delete(PASSWORD_RESET_COOKIE);
}
