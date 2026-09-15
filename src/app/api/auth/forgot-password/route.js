import { routeHandler, ok } from "@/lib/api";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { requestPasswordReset } from "@/services/auth.service";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

export const POST = routeHandler(
  async ({ request, body }) => {
    enforceRateLimit(clientKey(request, "forgot"), { limit: 5, windowMs: 15 * 60_000 });
    await requestPasswordReset(body.email);
    // Always the same response, whether or not the account exists.
    return ok({ sent: true });
  },
  { bodySchema: forgotPasswordSchema },
);
