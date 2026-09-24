import { after } from "next/server";
import { routeHandler, ok } from "@/lib/api";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import {
  requestPasswordReset,
  PASSWORD_RESET_CLIENT_LIMITS,
  PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS,
} from "@/services/password-reset.service";
import { setPasswordResetCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * Step one of forgot-password: an address in, a code on its way.
 *
 * Always the same response, whether or not the account exists. The account
 * lookup and the email run in `after()`, once this response has gone, so the
 * time it takes to answer says nothing either.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    await enforceRateLimit(clientKey(request, "forgot"), PASSWORD_RESET_CLIENT_LIMITS.request);
    const { requestToken, ...state } = await requestPasswordReset(body.email, {
      ip: clientKey(request),
      defer: after,
    });
    await setPasswordResetCookie(requestToken, PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS);
    return ok({ sent: true, ...state });
  },
  { bodySchema: forgotPasswordSchema },
);
