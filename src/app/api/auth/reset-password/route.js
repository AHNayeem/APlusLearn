import { routeHandler, ok } from "@/lib/api";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { resetPassword } from "@/services/password-reset.service";

/**
 * Step three: the new password, authorised by what a correct code was
 * exchanged for. Every existing session ends; the person signs in again with
 * the password they just chose.
 */
export const POST = routeHandler(
  async ({ request, body }) => {
    await resetPassword(body, { request });
    return ok({ reset: true, redirectTo: "/login?reset=1" });
  },
  { bodySchema: resetPasswordSchema },
);
