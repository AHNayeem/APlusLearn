import { routeHandler, ok } from "@/lib/api";
import { verifyResetCodeSchema } from "@/lib/validation/auth";
import {
  verifyPasswordResetCode,
  PASSWORD_RESET_CLIENT_LIMITS,
} from "@/services/password-reset.service";
import { readPasswordResetCookie, clearPasswordResetCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * Step two: the emailed code, checked against the request this browser holds.
 * A right answer is exchanged for a short-lived, single-use reset
 * authorisation, and the request is finished with.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    await enforceRateLimit(clientKey(request, "forgot-verify"), PASSWORD_RESET_CLIENT_LIMITS.verify);
    const result = await verifyPasswordResetCode({
      requestToken: await readPasswordResetCookie(),
      code: body.code,
    });
    await clearPasswordResetCookie();
    return ok(result);
  },
  { bodySchema: verifyResetCodeSchema },
);
