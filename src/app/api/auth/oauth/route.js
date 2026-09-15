import { routeHandler, ok } from "@/lib/api";
import { oauthSignInSchema } from "@/lib/validation/auth";
import { oauthSignIn } from "@/services/auth.service";
import { createSessionCookie, readOAuthNonce, clearOAuthNonce } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";
import { AppError } from "@/lib/api/errors";
import { availableOAuthProviders } from "@/services/external/oauth-provider";

/**
 * Social sign-in (§9, §36).
 *
 * The browser posts the provider's ID token. Everything that decides identity
 * happens server-side: the token's signature is checked against the provider's
 * JWKS, and its `nonce` claim must match the httpOnly cookie minted by
 * `/api/auth/oauth/nonce` for this attempt — a token captured elsewhere or
 * replayed later cannot satisfy both.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    enforceRateLimit(clientKey(request, "oauth"), { limit: 10, windowMs: 10 * 60_000 });

    const configured = availableOAuthProviders().some(
      (p) => p.provider === body.provider && p.configured,
    );
    const nonce = await readOAuthNonce();

    // A real provider flow always has a nonce. Missing one means the attempt
    // did not start here, so it is refused rather than verified loosely.
    if (configured && !nonce) {
      throw new AppError("That sign-in attempt has expired. Please try again.", {
        status: 400,
        code: "NONCE_MISSING",
      });
    }

    try {
      const user = await oauthSignIn({ ...body, nonce: configured ? nonce : undefined }, { request });
      await createSessionCookie(user);

      return ok({
        user: { id: user.id, firstName: user.firstName, role: user.role },
        redirectTo: body.next?.startsWith("/") ? body.next : homeForRole(user.role),
      });
    } finally {
      // One nonce, one attempt — successful or not.
      await clearOAuthNonce();
    }
  },
  { bodySchema: oauthSignInSchema },
);
