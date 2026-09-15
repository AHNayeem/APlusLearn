import { routeHandler, ok } from "@/lib/api";
import { resendVerificationSchema } from "@/lib/validation/auth";
import { resendVerification } from "@/services/auth.service";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

export const POST = routeHandler(
  async ({ request, body }) => {
    enforceRateLimit(clientKey(request, "resend"), { limit: 3, windowMs: 15 * 60_000 });
    await resendVerification(body.email);
    return ok({ sent: true });
  },
  { bodySchema: resendVerificationSchema },
);
