import { routeHandler, ok } from "@/lib/api";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { resetPassword } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { homeForRole } from "@/constants/navigation";

export const POST = routeHandler(
  async ({ body }) => {
    const user = await resetPassword(body);
    await createSessionCookie(user);
    return ok({ reset: true, redirectTo: homeForRole(user.role) });
  },
  { bodySchema: resetPasswordSchema },
);
