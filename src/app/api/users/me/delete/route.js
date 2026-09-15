import { routeHandler, ok } from "@/lib/api";
import { deleteAccountSchema } from "@/lib/validation/users";
import { deleteAccount } from "@/services/user.service";
import { destroySessionCookie } from "@/lib/auth/session";

/** Account deletion (§35). Anonymises rather than erasing financial history. */
export const POST = routeHandler(
  async ({ request, user, body }) => {
    await deleteAccount(user.id, body, request);
    await destroySessionCookie();
    return ok({ deleted: true });
  },
  { auth: true, bodySchema: deleteAccountSchema },
);
