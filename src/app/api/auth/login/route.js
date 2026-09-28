import { after } from "next/server";
import { routeHandler, ok } from "@/lib/api";
import { loginSchema } from "@/lib/validation/auth";
import { authenticateWithPassword, recordSignIn } from "@/services/auth.service";
import {
  isTrustedDevice,
  startLoginChallenge,
  LOGIN_CHALLENGE_MAX_AGE_SECONDS,
} from "@/services/login-verification.service";
import {
  createSessionCookie,
  readDeviceCookie,
  setLoginChallengeCookie,
  clearLoginChallengeCookie,
} from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";
import { internalPath } from "@/lib/utils/url";

/**
 * Password sign-in (§9).
 *
 * A right password from a trusted browser is a session. From any other
 * browser it is a new-device challenge instead: no session, an emailed code,
 * and `/login/verify` to enter it — see `login-verification.service`.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    // Limit per IP *and* per account so neither vector is left open.
    await enforceRateLimit(clientKey(request, "login"), { limit: 10, windowMs: 10 * 60_000 });
    await enforceRateLimit(`login:${body.email}`, { limit: 6, windowMs: 10 * 60_000 });

    const user = await authenticateWithPassword(body);

    if (!(await isTrustedDevice(user, await readDeviceCookie()))) {
      const { challengeToken, ...challenge } = await startLoginChallenge(user, {
        remember: body.remember,
        next: body.next,
        ip: clientKey(request),
        userAgent: request.headers.get("user-agent"),
        defer: after,
      });
      await setLoginChallengeCookie(challengeToken, LOGIN_CHALLENGE_MAX_AGE_SECONDS);
      return ok({ verificationRequired: true, redirectTo: "/login/verify", ...challenge });
    }

    await recordSignIn(user, { request });
    await createSessionCookie(user, { remember: body.remember });
    // A challenge left over from an earlier attempt in this browser is moot.
    await clearLoginChallengeCookie();

    return ok({
      user: { id: user.id, firstName: user.firstName, role: user.role, email: user.email },
      // `next` is already reduced to a path on this application by the
      // schema; this is the fallback when there was not one.
      redirectTo: internalPath(body.next) ?? homeForRole(user.role),
    });
  },
  { bodySchema: loginSchema },
);
