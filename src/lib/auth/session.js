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
