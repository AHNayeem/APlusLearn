import { routeHandler, ok } from "@/lib/api";
import { oauthSignInSchema } from "@/lib/validation/auth";
import { developmentOAuthSignIn } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";
import { homeForRole } from "@/constants/navigation";
import { AppError } from "@/lib/api/errors";
import { requireSignInAvailability } from "@/services/external/oauth-provider";
import { internalPath } from "@/lib/utils/url";

/**
 * The development sign-in identity (§9, §38).
 *
 * Real Google and Apple sign-in never come here — they run the
 * authorization-code flow through `/api/auth/oauth/[provider]` and its
 * callback. This endpoint exists so the social sign-in path stays usable on a
 * development deployment with no provider account at all, and it refuses
 * everything else:
 *
 *   • a provider the operator switched off or left unticked (403), and
 *   • any provider that is configured for real, because a real provider must
 *     never be satisfiable by a self-asserted identity (403).
 *
 * `signInAvailability()` only reports `development` when nothing is
 * configured and the deployment is not production, and the development
 * provider refuses on its own in production as a second guard.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    await enforceRateLimit(clientKey(request, "oauth"), { limit: 10, windowMs: 10 * 60_000 });

    const { availability } = await requireSignInAvailability(body.provider);
    if (availability.mode !== "development") {
      throw new AppError(
        `${availability.label} sign-in is configured on this platform. Use the Continue with ${availability.label} button.`,
        { status: 403, code: "FORBIDDEN" },
      );
    }

    const user = await developmentOAuthSignIn(body, { request });
    await createSessionCookie(user);

    return ok({
      user: { id: user.id, firstName: user.firstName, role: user.role },
      // `next` is already reduced to a path on this application by the
      // schema; this is the fallback when there was not one.
      redirectTo: internalPath(body.next) ?? homeForRole(user.role),
    });
  },
  { bodySchema: oauthSignInSchema },
);
