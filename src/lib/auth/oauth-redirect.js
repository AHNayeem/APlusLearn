import "server-only";
import { NextResponse } from "next/server";
import { AUTH_PROVIDERS } from "@/constants";
import { envBaseUrl } from "@/lib/config/base-url";
import { clearOAuthTransactionCookie } from "./session";
import { oauthErrorCode } from "./oauth-errors";

/**
 * How the social sign-in routes answer a browser (§9).
 *
 * Both routes are navigations, not API calls — the person arrives from a
 * button or from the provider — so every outcome is a redirect. Failures land
 * on the page the attempt started from with a code from `oauth-errors.js`,
 * never with a message, and always consume the transaction cookie.
 *
 * Absolute URLs are built from `NEXT_PUBLIC_APP_URL` rather than the request,
 * for the same reason the redirect URI is: a forged Host header must not be
 * able to choose where somebody is sent.
 */
export function redirectTo(path, status = 303) {
  const response = NextResponse.redirect(new URL(path, envBaseUrl()), status);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function oauthFailureRedirect({ from = "login", error, code, provider } = {}) {
  const reason = code ?? oauthErrorCode(error?.code);

  // An exposed AppError is an expected outcome (expired attempt, cancelled,
  // suspended). Anything else is a defect worth a line in the log — by message
  // only, since a provider library's error could otherwise carry a token.
  if (error && !error.expose) {
    console.error(`[oauth] ${provider ?? "sign-in"} failed unexpectedly:`, error.message);
  }

  const page = from === "register" ? "/register" : "/login";
  const response = redirectTo(`${page}?oauthError=${encodeURIComponent(reason)}`);
  clearOAuthTransactionCookie(response, { crossSitePost: provider === AUTH_PROVIDERS.APPLE });
  return response;
}
