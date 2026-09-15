import { routeHandler, ok } from "@/lib/api";
import { updateProfileSchema } from "@/lib/validation/users";
import { getUser, updateProfile } from "@/services/user.service";

export const GET = routeHandler(async ({ user }) => ok({ user: await getUser(user.id) }), {
  auth: true,
});

export const PATCH = routeHandler(
  async ({ user, body }) => ok({ user: await updateProfile(user.id, body) }),
  { auth: true, bodySchema: updateProfileSchema },
);
