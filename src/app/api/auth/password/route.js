import { routeHandler, ok } from "@/lib/api";
import { changePasswordSchema } from "@/lib/validation/auth";
import { changePassword } from "@/services/auth.service";
import { createSessionCookie } from "@/lib/auth/session";
import { getUser } from "@/services/user.service";

export const PATCH = routeHandler(
  async ({ user, body }) => {
    await changePassword(user.id, body);
    // The change bumps tokenVersion, so the current cookie must be reissued.
    const refreshed = await getUser(user.id);
    await createSessionCookie(refreshed);
    return ok({ changed: true });
  },
  { auth: true, bodySchema: changePasswordSchema },
);
