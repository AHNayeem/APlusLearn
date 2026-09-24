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

export async function signSessionToken({ userId, role, tokenVersion }) {
  return new SignJWT({ role, tv: tokenVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION.maxAgeSeconds}s`)
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
    return { userId: payload.sub, role: payload.role, tokenVersion: payload.tv ?? 0 };
  } catch {
    return null;
  }
}

export async function createSessionCookie(user) {
  const token = await signSessionToken({
    userId: user._id ?? user.id,
    role: user.role,
    tokenVersion: user.tokenVersion ?? 0,
  });
  const store = await cookies();
  store.set(SESSION.cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION.maxAgeSeconds,
  });
  return token;
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
 * Single-use sign-in nonce for OAuth (§9, §36).
 *
 * The value is handed to the provider's client library and comes back inside
 * the signed ID token; the copy in this httpOnly cookie is what the server
 * compares it against. An ID token captured from another site, or replayed
 * later, will not have a matching cookie — which is the CSRF and replay
 * protection for a flow that has no redirect to carry `state`.
 */
const OAUTH_NONCE_COOKIE = "aplus_oauth_nonce";
const OAUTH_NONCE_MAX_AGE = 10 * 60;

export async function issueOAuthNonce() {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const store = await cookies();
  store.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_NONCE_MAX_AGE,
  });
  return nonce;
}

export async function readOAuthNonce() {
  const store = await cookies();
  return store.get(OAUTH_NONCE_COOKIE)?.value ?? null;
}

/** Consume it: a nonce is good for exactly one sign-in attempt. */
export async function clearOAuthNonce() {
  const store = await cookies();
  store.delete(OAUTH_NONCE_COOKIE);
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
