import { after } from "next/server";
import { routeHandler, ok } from "@/lib/api";
import {
  resendPasswordResetCode,
  PASSWORD_RESET_CLIENT_LIMITS,
  PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS,
} from "@/services/password-reset.service";
import { readPasswordResetCookie, setPasswordResetCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * A fresh code for the request this browser already holds. The address comes
 * from the signed handle, never the body, and the previous code stops working.
 */
export const POST = routeHandler(async ({ request }) => {
  await enforceRateLimit(clientKey(request, "forgot"), PASSWORD_RESET_CLIENT_LIMITS.request);
  const { requestToken, ...state } = await resendPasswordResetCode(await readPasswordResetCookie(), {
    ip: clientKey(request),
    defer: after,
  });
  await setPasswordResetCookie(requestToken, PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS);
  return ok({ sent: true, ...state });
});
