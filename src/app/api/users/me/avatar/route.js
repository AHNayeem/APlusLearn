import { routeHandler, ok, ValidationError } from "@/lib/api";
import { uploadAvatar, removeAvatar } from "@/services/user.service";

/**
 * A person's own profile photo (§8, §16).
 *
 * `auth: true` and nothing else, and that *is* the authorization: the account
 * acted on is the one in the session — `user.id`, never a field of the
 * request — so there is no id to tamper with and no other account this
 * endpoint can be aimed at. An administrator changing somebody else's details
 * is a different endpoint, under a different permission, and stays that way.
 *
 * Multipart rather than JSON, so the payload is read from `FormData` the way
 * the branding and verification uploads are. The file itself is not validated
 * here: the size, the format and the dimensions are all decided from the bytes
 * inside the service, because a check in a route is a check a second caller
 * can skip.
 */
export const POST = routeHandler(
  async ({ request, user }) => {
    const form = await request.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      throw new ValidationError({ fieldErrors: { file: ["Choose a photo to upload."] } });
    }

    return ok({ user: await uploadAvatar(user.id, file) });
  },
  { auth: true },
);

export const DELETE = routeHandler(
  async ({ user }) => ok({ user: await removeAvatar(user.id) }),
  { auth: true },
);
