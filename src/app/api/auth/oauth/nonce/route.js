import { routeHandler, ok } from "@/lib/api";
import { issueOAuthNonce } from "@/lib/auth/session";
import { availableOAuthProviders } from "@/services/external/oauth-provider";

/**
 * Mint a single-use nonce for a social sign-in attempt (§9, §36).
 *
 * The value is returned so the browser can hand it to Google's or Apple's
 * client library, and is simultaneously stored in an httpOnly cookie. The
 * sign-in endpoint then requires the ID token's `nonce` claim to match the
 * cookie, which is what makes a stolen or replayed token useless here.
 */
export const GET = routeHandler(
  async () => {
    const nonce = await issueOAuthNonce();
    return ok({
      nonce,
      providers: availableOAuthProviders(),
      // Public client identifiers; the secrets stay on the server.
      googleClientId: process.env.GOOGLE_CLIENT_ID ?? null,
      appleClientId: process.env.APPLE_CLIENT_ID ?? null,
    });
  },
  { database: false },
);
