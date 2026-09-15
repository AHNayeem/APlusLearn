import { routeHandler, ok } from "@/lib/api";
import { oauthSignInSchema } from "@/lib/validation/auth";
import { oauthSignIn } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";

export const POST = routeHandler(
  async ({ request, body }) => {
    enforceRateLimit(clientKey(request, "oauth"), { limit: 10, windowMs: 10 * 60_000 });

    const user = await oauthSignIn(body, { request });
    await createSessionCookie(user);

    return ok({
      user: { id: user.id, firstName: user.firstName, role: user.role },
      redirectTo: body.next?.startsWith("/") ? body.next : homeForRole(user.role),
    });
  },
  { bodySchema: oauthSignInSchema },
);
