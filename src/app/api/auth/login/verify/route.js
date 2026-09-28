import { routeHandler, ok } from "@/lib/api";
import { verifyLoginCodeSchema } from "@/lib/validation/auth";
import {
  verifyLoginCode,
  LOGIN_VERIFICATION_CLIENT_LIMITS,
  TRUSTED_DEVICE_MAX_AGE_SECONDS,
} from "@/services/login-verification.service";
import {
  createSessionCookie,
  readDeviceCookie,
  setDeviceCookie,
  readLoginChallengeCookie,
  clearLoginChallengeCookie,
} from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";
import { internalPath } from "@/lib/utils/url";

/**
 * The new-device sign-in code, checked against the challenge this browser
 * holds. A right answer trusts the browser and signs the person in, with the
 * "keep me signed in" choice and destination they made on the sign-in form.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    await enforceRateLimit(clientKey(request, "login-verify"), LOGIN_VERIFICATION_CLIENT_LIMITS.verify);

    const { user, deviceToken, remember, next } = await verifyLoginCode(
      {
        challengeToken: await readLoginChallengeCookie(),
        code: body.code,
        deviceToken: await readDeviceCookie(),
      },
      { ip: clientKey(request), userAgent: request.headers.get("user-agent"), request },
    );

    await clearLoginChallengeCookie();
    await setDeviceCookie(deviceToken, TRUSTED_DEVICE_MAX_AGE_SECONDS);
    await createSessionCookie(user, { remember });

    return ok({
      user: { id: user.id, firstName: user.firstName, role: user.role, email: user.email },
      // Sanitised when the challenge was issued; checked again because it
      // came back through the browser.
      redirectTo: internalPath(next) ?? homeForRole(user.role),
    });
  },
  { bodySchema: verifyLoginCodeSchema },
);
