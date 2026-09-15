import { routeHandler, ok } from "@/lib/api";
import { issueOAuthNonce } from "@/lib/auth/session";
import { availableOAuthProviders } from "@/services/external/oauth-provider";
import { getFeatureFlags } from "@/services/settings.service";
import { AUTH_PROVIDERS, FEATURES } from "@/constants";

/**
 * Mint a single-use nonce for a social sign-in attempt (§9, §36).
 *
 * The value is returned so the browser can hand it to Google's or Apple's
 * client library, and is simultaneously stored in an httpOnly cookie. The
 * sign-in endpoint then requires the ID token's `nonce` claim to match the
 * cookie, which is what makes a stolen or replayed token useless here.
 *
 * Two independent things decide whether a provider appears: whether it has
 * credentials (deployment configuration) and whether the operator has left it
 * switched on (platform settings). A provider that fails either test is not
 * offered, and `/api/auth/oauth` refuses it regardless of what is posted.
 */
export const GET = routeHandler(
  async () => {
    const [nonce, features] = await Promise.all([issueOAuthNonce(), getFeatureFlags()]);

    const providers = availableOAuthProviders().filter((p) =>
      p.provider === AUTH_PROVIDERS.GOOGLE
        ? features[FEATURES.GOOGLE_SIGN_IN] !== false
        : features[FEATURES.APPLE_SIGN_IN] !== false,
    );

    return ok({
      nonce,
      providers,
      // Public client identifiers; the secrets stay on the server.
      googleClientId: process.env.GOOGLE_CLIENT_ID ?? null,
      appleClientId: process.env.APPLE_CLIENT_ID ?? null,
    });
  },
);
