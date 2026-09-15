import { routeHandler, ok } from "@/lib/api";
import { verifyEmailSchema } from "@/lib/validation/auth";
import { verifyEmail } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { homeForRole } from "@/constants/navigation";

export const POST = routeHandler(
  async ({ body }) => {
    const user = await verifyEmail(body.token);
    // Verifying signs the person in — the link came from their inbox.
    await createSessionCookie(user);
    return ok({ verified: true, redirectTo: homeForRole(user.role) });
  },
  { bodySchema: verifyEmailSchema },
);
