import { routeHandler, created } from "@/lib/api";
import { registerSchema } from "@/lib/validation/auth";
import { register } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";

export const POST = routeHandler(
  async ({ request, body }) => {
    await enforceRateLimit(clientKey(request, "register"), { limit: 5, windowMs: 15 * 60_000 });

    const user = await register(body, { request });
    await createSessionCookie(user);

    return created({
      user: { id: user.id, firstName: user.firstName, role: user.role, email: user.email },
      redirectTo: user.role === "TUTOR" ? "/tutor/onboarding" : homeForRole(user.role),
    });
  },
  { bodySchema: registerSchema },
);
