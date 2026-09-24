import { routeHandler, ok, created } from "@/lib/api";
import {
  startPhoneVerificationSchema,
  confirmPhoneVerificationSchema,
} from "@/lib/validation/users";
import {
  startPhoneVerification,
  confirmPhoneVerification,
  removePhone,
} from "@/services/sms.service";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * Confirming a mobile number (§41 Phase 2).
 *
 * POST sends a code, PATCH confirms it, DELETE takes the number off the
 * account. Two limits apply to the send: one per account inside the service,
 * which is what stops a single account draining an SMS budget, and one per
 * IP here, which is what stops a script walking through numbers. Each texts
 * money, so neither is optional (§36).
 */
export const POST = routeHandler(
  async ({ user, body, request }) => {
    await enforceRateLimit(clientKey(request, "phone-verify"), { limit: 5, windowMs: 15 * 60_000 });
    return created(
      await startPhoneVerification(user.id, body, {
        ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      }),
    );
  },
  { auth: true, verifiedEmail: true, bodySchema: startPhoneVerificationSchema },
);

export const PATCH = routeHandler(
  async ({ user, body, request }) => {
    // Guessing a six-digit code is cheap without this; the service also burns
    // the code after a handful of wrong answers.
    await enforceRateLimit(clientKey(request, "phone-confirm"), { limit: 10, windowMs: 15 * 60_000 });
    return ok({ user: await confirmPhoneVerification(user.id, body, user) });
  },
  { auth: true, bodySchema: confirmPhoneVerificationSchema },
);

export const DELETE = routeHandler(
  async ({ user }) => ok({ user: await removePhone(user.id, user) }),
  { auth: true },
);
