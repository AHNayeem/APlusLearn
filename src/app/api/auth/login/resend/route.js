import { after } from "next/server";
import { routeHandler, ok } from "@/lib/api";
import {
  resendLoginCode,
  LOGIN_VERIFICATION_CLIENT_LIMITS,
  LOGIN_CHALLENGE_MAX_AGE_SECONDS,
} from "@/services/login-verification.service";
import { readLoginChallengeCookie, setLoginChallengeCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * A fresh sign-in code for the challenge this browser already holds. The
 * account comes from the signed handle, never the body, and the previous
 * code stops working.
 */
export const POST = routeHandler(async ({ request }) => {
  await enforceRateLimit(clientKey(request, "login-resend"), LOGIN_VERIFICATION_CLIENT_LIMITS.resend);
  const { challengeToken, ...challenge } = await resendLoginCode(await readLoginChallengeCookie(), {
    ip: clientKey(request),
    userAgent: request.headers.get("user-agent"),
    defer: after,
  });
  await setLoginChallengeCookie(challengeToken, LOGIN_CHALLENGE_MAX_AGE_SECONDS);
  return ok({ sent: true, ...challenge });
});
