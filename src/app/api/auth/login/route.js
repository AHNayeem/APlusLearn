import { routeHandler, ok } from "@/lib/api";
import { loginSchema } from "@/lib/validation/auth";
import { login } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";

export const POST = routeHandler(
  async ({ request, body }) => {
    // Limit per IP *and* per account so neither vector is left open.
    enforceRateLimit(clientKey(request, "login"), { limit: 10, windowMs: 10 * 60_000 });
    enforceRateLimit(`login:${body.email}`, { limit: 6, windowMs: 10 * 60_000 });

    const user = await login(body, { request });
    await createSessionCookie(user);

    return ok({
      user: { id: user.id, firstName: user.firstName, role: user.role, email: user.email },
      redirectTo: body.next?.startsWith("/") ? body.next : homeForRole(user.role),
    });
  },
  { bodySchema: loginSchema },
);
