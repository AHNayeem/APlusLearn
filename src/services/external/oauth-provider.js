import "server-only";
import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AUTH_PROVIDERS } from "@/constants";
import { AppError } from "@/lib/api/errors";
import { requireIntegration, resolveIntegration, DEVELOPMENT } from "@/lib/config/env";

/**
 * Google / Apple sign-in abstraction (§9, §38).
 *
 * `verifyCredential` is the only thing the auth service calls: it takes the
 * credential the browser received from the provider and returns a verified
 * identity, or throws. The production implementation validates the ID token's
 * signature against the provider's published JWKS and checks every claim that
 * matters — issuer, audience, expiry and the single-use nonce this server
 * issued — before the identity is allowed anywhere near a user record.
 *
 * What it deliberately does *not* do is decide anything about the account.
 * Role, status and linking rules stay in `auth.service`, where the existing
 * RBAC lives.
 */

export class OAuthProvider {
  async verifyCredential() {
    throw new Error("not implemented");
  }
}

class DevOAuthProvider extends OAuthProvider {
  get name() {
    return "DEVELOPMENT";
  }
  get configured() {
    return false;
  }

  /**
   * Accepts a base64url-encoded JSON identity produced by the dev sign-in
   * button. It is intentionally inert in production.
   */
  async verifyCredential({ provider, credential }) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(
        `${provider === AUTH_PROVIDERS.APPLE ? "Apple" : "Google"} sign-in is not configured yet. Use your email and password.`,
        { status: 503, code: "PROVIDER_UNAVAILABLE" },
      );
    }

    let identity;
    try {
      identity = JSON.parse(Buffer.from(credential, "base64url").toString("utf8"));
    } catch {
      throw new AppError("That sign-in response could not be read.", {
        status: 400,
        code: "INVALID_CREDENTIAL",
      });
    }

    if (!identity?.email) {
      throw new AppError("The provider did not share an email address.", {
        status: 400,
        code: "INVALID_CREDENTIAL",
      });
    }

    return {
      provider,
      providerAccountId: identity.sub ?? `dev-${identity.email}`,
      email: String(identity.email).toLowerCase(),
      emailVerified: identity.email_verified ?? true,
      firstName: identity.given_name ?? identity.firstName ?? "New",
      lastName: identity.family_name ?? identity.lastName ?? "User",
      avatarUrl: identity.picture,
    };
  }
}

// --- Production: OpenID Connect ID-token verification ----------------------

/**
 * Each provider's published signing keys. `createRemoteJWKSet` caches the key
 * set and refetches on rotation, so this is one network round trip per key
 * rollover rather than one per sign-in.
 */
const JWKS = {
  [AUTH_PROVIDERS.GOOGLE]: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
  [AUTH_PROVIDERS.APPLE]: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
};

const ISSUERS = {
  [AUTH_PROVIDERS.GOOGLE]: ["https://accounts.google.com", "accounts.google.com"],
  [AUTH_PROVIDERS.APPLE]: ["https://appleid.apple.com"],
};

export class OpenIdOAuthProvider extends OAuthProvider {
  constructor({ googleClientId, appleClientId, jwks = JWKS } = {}) {
    super();
    this.clientIds = {
      [AUTH_PROVIDERS.GOOGLE]: googleClientId,
      [AUTH_PROVIDERS.APPLE]: appleClientId,
    };
    this.jwks = jwks;
  }

  get name() {
    return "OPENID";
  }

  supports(provider) {
    return Boolean(this.clientIds[provider]);
  }

  /**
   * Verify a provider ID token.
   *
   * @param {object} args
   * @param {string} args.provider       GOOGLE | APPLE
   * @param {string} args.credential     The raw ID token (a JWT).
   * @param {string} [args.expectedNonce] The nonce this server issued for
   *   this sign-in attempt. Required whenever the browser was given one;
   *   it is what stops a token captured elsewhere being replayed here.
   * @param {object} [args.profile]      Apple sends the name once, outside
   *   the token, on first sign-in only.
   */
  async verifyCredential({ provider, credential, expectedNonce, profile }) {
    const audience = this.clientIds[provider];
    if (!audience) {
      throw new AppError(
        `${label(provider)} sign-in is not configured. Use your email and password.`,
        { status: 503, code: "PROVIDER_UNAVAILABLE" },
      );
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(credential, this.jwks[provider], {
        issuer: ISSUERS[provider],
        audience,
        // Tokens are minted seconds before they reach us; anything older is
        // being replayed.
        maxTokenAge: "10 minutes",
        clockTolerance: 60,
      }));
    } catch (error) {
      throw new AppError("That sign-in could not be verified. Please try again.", {
        status: 401,
        code: "INVALID_CREDENTIAL",
        details: process.env.NODE_ENV === "production" ? undefined : { reason: error.message },
      });
    }

    // Replay / CSRF: the token must carry the nonce we minted for this
    // attempt. Apple hashes the nonce for some client types, so accept both
    // the raw value and its SHA-256.
    if (expectedNonce) {
      const hashed = createHash("sha256").update(expectedNonce).digest("hex");
      if (payload.nonce !== expectedNonce && payload.nonce !== hashed) {
        throw new AppError("That sign-in has expired. Please try again.", {
          status: 401,
          code: "NONCE_MISMATCH",
        });
      }
    }

    const email = payload.email ? String(payload.email).toLowerCase() : null;
    if (!email) {
      throw new AppError(
        "Your provider didn't share an email address, so we can't create your account. Sign up with an email and password instead.",
        { status: 400, code: "EMAIL_NOT_SHARED" },
      );
    }

    return {
      provider,
      providerAccountId: String(payload.sub),
      email,
      // Google sends a boolean; Apple sends the string "true".
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
      // Apple never puts a name in the token — it arrives once, alongside it.
      firstName: payload.given_name ?? profile?.firstName ?? null,
      lastName: payload.family_name ?? profile?.lastName ?? null,
      avatarUrl: provider === AUTH_PROVIDERS.GOOGLE ? (payload.picture ?? null) : null,
      // Apple marks relay addresses; useful when explaining bounces later.
      isPrivateRelay: payload.is_private_email === true || payload.is_private_email === "true",
    };
  }
}

function label(provider) {
  return provider === AUTH_PROVIDERS.APPLE ? "Apple" : "Google";
}

let cached = null;

export function getOAuthProvider() {
  const { name } = requireIntegration("oauth");
  if (cached?.key === name) return cached.provider;

  const provider =
    name === DEVELOPMENT
      ? new DevOAuthProvider()
      : new OpenIdOAuthProvider({
          googleClientId: process.env.GOOGLE_CLIENT_ID,
          appleClientId: process.env.APPLE_CLIENT_ID,
        });

  cached = { key: name, provider };
  return provider;
}

/** Which providers the UI should offer, and whether they are real. */
export function availableOAuthProviders() {
  const resolved = resolveIntegration("oauth");
  const production = resolved.configured && resolved.name !== DEVELOPMENT;

  return [
    {
      provider: AUTH_PROVIDERS.GOOGLE,
      label: "Continue with Google",
      configured: production && Boolean(process.env.GOOGLE_CLIENT_ID),
    },
    {
      provider: AUTH_PROVIDERS.APPLE,
      label: "Continue with Apple",
      configured: production && Boolean(process.env.APPLE_CLIENT_ID),
    },
  ];
}
