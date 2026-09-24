import { AUTH_PROVIDERS } from "@/constants";
import { connectToDatabase } from "@/lib/db/connect";
import {
  applySessionCookie,
  clearOAuthTransactionCookie,
  readOAuthTransactionCookie,
} from "@/lib/auth/session";
import { oauthFailureRedirect, redirectTo } from "@/lib/auth/oauth-redirect";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { signInProviderFromKey } from "@/services/external/oauth-provider";
import {
  completeSignIn,
  parseAppleProfile,
  readSignInTransaction,
} from "@/services/oauth-signin.service";

/**
 * Where Google and Apple send the person back (§9, §36).
 *
 *   Google → GET  /api/auth/oauth/google/callback?code&state
 *   Apple  → POST /api/auth/oauth/apple/callback   (form_post: code, state, user)
 *
 * Each provider is accepted only on the method it actually uses. Everything
 * that decides identity happens server-side, in this order: the transaction
 * cookie is opened, its `state` compared with the one echoed back, the
 * provider re-checked as still enabled, the code redeemed with the secret, and
 * the ID token verified (signature, issuer, audience, expiry, nonce). Only then
 * are the existing account rules applied and a session issued.
 *
 * The transaction cookie is consumed whatever happens. A failure lands on the
 * page the attempt started from with a fixed error code and no session.
 */
const MAX_FORM_BYTES = 16 * 1024;

async function handle(request, params, method, readFields) {
  const { provider: key } = await params;
  const provider = signInProviderFromKey(key);
  const transaction = readSignInTransaction(readOAuthTransactionCookie(request));
  const from = transaction?.o ?? "login";

  if (!provider) return oauthFailureRedirect({ from, code: "PROVIDER_DISABLED" });

  const expected = provider === AUTH_PROVIDERS.APPLE ? "POST" : "GET";
  if (method !== expected) return oauthFailureRedirect({ from, code: "FAILED", provider });

  const fields = await readFields();

  // The person declined on the provider's screen, or the provider refused to
  // continue. Not something to log as a failure.
  if (fields.error) {
    const cancelled = ["access_denied", "user_cancelled_authorize"].includes(fields.error);
    return oauthFailureRedirect({ from, code: cancelled ? "CANCELLED" : "FAILED", provider });
  }

  try {
    await connectToDatabase();
    await enforceRateLimit(clientKey(request, "oauth-callback"), { limit: 20, windowMs: 10 * 60_000 });

    const { user, redirectTo: destination } = await completeSignIn(
      provider,
      {
        transaction,
        state: fields.state,
        code: fields.code,
        profile: provider === AUTH_PROVIDERS.APPLE ? parseAppleProfile(fields.user) : undefined,
      },
      { request },
    );

    const response = redirectTo(destination, 303);
    await applySessionCookie(response, user);
    clearOAuthTransactionCookie(response, { crossSitePost: provider === AUTH_PROVIDERS.APPLE });
    return response;
  } catch (error) {
    return oauthFailureRedirect({ from, error, provider });
  }
}

export async function GET(request, { params }) {
  return handle(request, params, "GET", async () =>
    Object.fromEntries(new URL(request.url).searchParams),
  );
}

export async function POST(request, { params }) {
  return handle(request, params, "POST", async () => {
    // Apple's form is a handful of short fields. Anything larger is not it.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return {};
    const form = await request.formData().catch(() => null);
    if (!form) return {};
    return Object.fromEntries(
      [...form.entries()].filter(([, value]) => typeof value === "string"),
    );
  });
}
