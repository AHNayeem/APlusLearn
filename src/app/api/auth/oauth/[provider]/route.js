import { AUTH_PROVIDERS } from "@/constants";
import { connectToDatabase } from "@/lib/db/connect";
import { setOAuthTransactionCookie } from "@/lib/auth/session";
import { oauthFailureRedirect, redirectTo } from "@/lib/auth/oauth-redirect";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { oauthStartQuerySchema } from "@/lib/validation/auth";
import { signInProviderFromKey } from "@/services/external/oauth-provider";
import { beginSignIn } from "@/services/oauth-signin.service";

/**
 * Start a Google or Apple sign-in (§9).
 *
 * `GET /api/auth/oauth/google?role=&next=&from=` — the sign-in button is a
 * plain navigation here. The provider's configuration is read server-side on
 * every request, and a method that is switched off, unticked or incomplete is
 * refused *here*: the person is sent back to the sign-in page and never
 * reaches the provider, whatever link they followed.
 *
 * On success the browser is redirected to the provider carrying only public
 * values (client ID, redirect URI, state, nonce, PKCE challenge) and holds an
 * encrypted transaction cookie the callback will check.
 *
 * Not wrapped in `routeHandler`: the answer is a redirect, not the JSON
 * envelope, for exactly the reason the calendar callback gives.
 */
export async function GET(request, { params }) {
  const { provider: key } = await params;
  const provider = signInProviderFromKey(key);

  const query = oauthStartQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const from = query.success ? query.data.from : "login";

  if (!provider) return oauthFailureRedirect({ from, code: "PROVIDER_DISABLED" });
  // Only `role` can fail — `next` and `from` degrade rather than refuse — and
  // a crafted role is not worth explaining.
  if (!query.success) return oauthFailureRedirect({ from, code: "FAILED", provider });

  try {
    await connectToDatabase();
    await enforceRateLimit(clientKey(request, "oauth-start"), { limit: 20, windowMs: 10 * 60_000 });

    const { url, transaction, maxAge } = await beginSignIn(provider, query.data);

    const response = redirectTo(url, 302);
    setOAuthTransactionCookie(response, transaction, {
      crossSitePost: provider === AUTH_PROVIDERS.APPLE,
      maxAge,
    });
    return response;
  } catch (error) {
    return oauthFailureRedirect({ from, error, provider });
  }
}
