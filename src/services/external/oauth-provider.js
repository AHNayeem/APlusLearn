import "server-only";
import { AUTH_PROVIDERS } from "@/constants";
import { AppError } from "@/lib/api/errors";

/**
 * Google / Apple sign-in abstraction (§9, §38).
 *
 * `verifyCredential` is the only thing the auth service calls: it takes the
 * credential the browser received from the provider and returns a verified
 * identity, or throws. The real implementation validates the ID token's
 * signature against the provider's JWKS; the development implementation
 * accepts a locally-issued payload so the flow is testable without client IDs.
 */

export class OAuthProvider {
  async verifyCredential() {
    throw new Error("not implemented");
  }
}

class DevOAuthProvider extends OAuthProvider {
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

let cached;

export function getOAuthProvider() {
  if (cached) return cached;
  // if (process.env.GOOGLE_CLIENT_ID) cached = new GoogleOAuthProvider(...)
  cached = new DevOAuthProvider();
  return cached;
}

/** Which providers the UI should offer. */
export function availableOAuthProviders() {
  return [
    {
      provider: AUTH_PROVIDERS.GOOGLE,
      label: "Continue with Google",
      configured: Boolean(process.env.GOOGLE_CLIENT_ID),
    },
    {
      provider: AUTH_PROVIDERS.APPLE,
      label: "Continue with Apple",
      configured: Boolean(process.env.APPLE_CLIENT_ID),
    },
  ];
}
