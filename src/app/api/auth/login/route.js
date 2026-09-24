import { routeHandler, ok } from "@/lib/api";
import { loginSchema } from "@/lib/validation/auth";
import { login } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";
import { internalPath } from "@/lib/utils/url";

export const POST = routeHandler(
  async ({ request, body }) => {
    // Limit per IP *and* per account so neither vector is left open.
    await enforceRateLimit(clientKey(request, "login"), { limit: 10, windowMs: 10 * 60_000 });
    await enforceRateLimit(`login:${body.email}`, { limit: 6, windowMs: 10 * 60_000 });

    const user = await login(body, { request });
    await createSessionCookie(user);

    return ok({
      user: { id: user.id, firstName: user.firstName, role: user.role, email: user.email },
      // `next` is already reduced to a path on this application by the
      // schema; this is the fallback when there was not one.
      redirectTo: internalPath(body.next) ?? homeForRole(user.role),
    });
  },
  { bodySchema: loginSchema },
);
