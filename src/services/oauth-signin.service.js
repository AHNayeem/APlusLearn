import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AUTH_PROVIDERS, ROLES } from "@/constants";
import { signInCallbackPath } from "@/constants/integrations";
import { homeForRole } from "@/constants/navigation";
import { AppError } from "@/lib/api/errors";
import { envBaseUrl } from "@/lib/config/base-url";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { internalPath } from "@/lib/utils/url";
import { requireSignInProvider } from "./external/oauth-provider";
import { signInWithIdentity } from "./auth.service";

/**
 * The Google / Apple authorization-code flow (§9, §36).
 *
 *   begin     → a provider URL, plus an encrypted transaction for the browser
 *   provider  → the person signs in there and is sent back with a code
 *   complete  → state checked, code redeemed, ID token verified, account
 *               resolved by the existing rules, session issued by the route
 *
 * ## What protects each step
 *
 *   • `state` — random, echoed by the provider, and compared against the copy
 *     in the transaction cookie. A callback this browser did not start is
 *     refused before any code is redeemed (login CSRF).
 *   • `nonce` — random, placed in the ID token by the provider, and compared
 *     by the verifier. A token minted for a different attempt cannot finish
 *     this one.
 *   • PKCE (Google) — the code is useless without the verifier, which never
 *     leaves this server and the cookie.
 *   • The transaction is AES-256-GCM encrypted under its own key label, so
 *     the browser holds it but can neither read nor alter it, and it expires.
 *   • The redirect URI is derived from `NEXT_PUBLIC_APP_URL`, never from the
 *     request, so a spoofed Host header cannot redirect a code elsewhere.
 */

const TRANSACTION_LABEL = "aplus:oauth-signin";
export const SIGN_IN_TRANSACTION_TTL_SECONDS = 10 * 60;

const SIGN_UP_ROLES = new Set([ROLES.PARENT, ROLES.STUDENT, ROLES.TUTOR]);

/** The exact redirect URI registered with the provider. */
export function signInRedirectUri(provider) {
  return `${envBaseUrl()}${signInCallbackPath(provider)}`;
}

function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function s256(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function sameToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Step one: where to send the person, and what their browser must hold.
 *
 * Refuses a provider that is switched off, unticked or incomplete — the
 * check that stops a crafted start link from reaching the provider at all.
 */
export async function beginSignIn(provider, { role, next, from = "login" } = {}) {
  const adapter = await requireSignInProvider(provider);

  const state = randomToken();
  const nonce = randomToken();
  // Apple documents no PKCE support; its code is bound by the client secret
  // only this server can sign.
  const codeVerifier = provider === AUTH_PROVIDERS.GOOGLE ? randomToken(48) : undefined;

  const transaction = encryptSecret(
    JSON.stringify({
      p: provider,
      s: state,
      n: nonce,
      v: codeVerifier,
      r: SIGN_UP_ROLES.has(role) ? role : null,
      x: internalPath(next) ?? null,
      o: from === "register" ? "register" : "login",
      e: Math.floor(Date.now() / 1000) + SIGN_IN_TRANSACTION_TTL_SECONDS,
    }),
    TRANSACTION_LABEL,
  );

  const url = adapter.authorizationUrl({
    redirectUri: signInRedirectUri(provider),
    state,
    nonce,
    codeChallenge: codeVerifier ? s256(codeVerifier) : undefined,
  });

  return { url, transaction, maxAge: SIGN_IN_TRANSACTION_TTL_SECONDS };
}

/**
 * Open a transaction cookie. Null for anything missing, altered, encrypted
 * under another key, malformed or expired — the callers treat all of those
 * the same way, because the person's fix is the same: start again.
 */
export function readSignInTransaction(value) {
  if (!value) return null;
  const plaintext = decryptSecret(value, TRANSACTION_LABEL);
  if (!plaintext) return null;
  try {
    const tx = JSON.parse(plaintext);
    if (!tx?.p || !tx.s || !tx.n || !tx.e) return null;
    if (tx.e < Math.floor(Date.now() / 1000)) return null;
    return tx;
  } catch {
    return null;
  }
}

function stateInvalid() {
  return new AppError("That sign-in attempt expired or was started somewhere else. Please try again.", {
    status: 400,
    code: "STATE_INVALID",
  });
}

/**
 * Step two: finish the attempt the provider has sent back.
 *
 * @param {string} provider  From the callback's own URL.
 * @param {object} input
 * @param {object|null} input.transaction  Already opened by `readSignInTransaction`.
 * @param {string} input.state   As echoed by the provider.
 * @param {string} input.code    The authorization code.
 * @param {object} [input.profile]  Apple's one-time name.
 */
export async function completeSignIn(provider, { transaction, state, code, profile }, { request } = {}) {
  // The attempt must have been started by this browser, for this provider,
  // and recently — checked before the provider is contacted at all.
  if (!transaction || transaction.p !== provider || !sameToken(transaction.s, state)) {
    throw stateInvalid();
  }
  if (!code || typeof code !== "string" || code.length > 2048) {
    throw new AppError("The provider did not return a sign-in code. Please try again.", {
      status: 400,
      code: "CODE_MISSING",
    });
  }

  // Availability is checked again here, not only at the start: switching a
  // method off must also stop an attempt that was already on its way.
  const adapter = await requireSignInProvider(provider);

  const identity = await adapter.exchangeCode({
    code,
    redirectUri: signInRedirectUri(provider),
    codeVerifier: transaction.v,
    expectedNonce: transaction.n,
    profile,
  });

  const user = await signInWithIdentity(identity, {
    role: SIGN_UP_ROLES.has(transaction.r) ? transaction.r : undefined,
    request,
  });

  return { user, redirectTo: internalPath(transaction.x) ?? homeForRole(user.role) };
}

/**
 * Apple's `user` field: JSON, sent once, on the first sign-in only, and
 * outside the signed token — so it is used to fill blanks and nothing else.
 */
export function parseAppleProfile(raw) {
  if (!raw || typeof raw !== "string" || raw.length > 2000) return undefined;
  try {
    const name = JSON.parse(raw)?.name;
    const clean = (value) => (typeof value === "string" ? value.trim().slice(0, 60) : undefined);
    const profile = { firstName: clean(name?.firstName), lastName: clean(name?.lastName) };
    return profile.firstName || profile.lastName ? profile : undefined;
  } catch {
    return undefined;
  }
}
