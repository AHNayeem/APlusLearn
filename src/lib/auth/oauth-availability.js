import { AUTH_PROVIDERS, FEATURES } from "@/constants";

/**
 * Which social sign-in methods the operator has left switched on (§26).
 *
 * Shared by the login and register pages so the two can never offer different
 * buttons, and deliberately *not* the whole availability answer: whether a
 * provider has credentials is decided in `lib/config/env.js`, and whether a
 * given attempt is accepted is decided by `/api/auth/oauth`. This only removes
 * what an operator has turned off.
 */
export function enabledOAuthProviders(features) {
  const enabled = [];
  if (features?.[FEATURES.GOOGLE_SIGN_IN] !== false) enabled.push(AUTH_PROVIDERS.GOOGLE);
  if (features?.[FEATURES.APPLE_SIGN_IN] !== false) enabled.push(AUTH_PROVIDERS.APPLE);
  return enabled;
}
