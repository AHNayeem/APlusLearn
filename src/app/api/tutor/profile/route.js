import { routeHandler, ok } from "@/lib/api";
import { updateTutorProfileSchema } from "@/lib/validation/tutors";
import { getTutorProfileByUserId, updateTutorProfile } from "@/services/tutor.service";
import { PERMISSIONS, ROLES } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => ok({ profile: await getTutorProfileByUserId(user.id) }),
  { roles: ROLES.TUTOR },
);

export const PATCH = routeHandler(
  async ({ user, body }) => ok({ profile: await updateTutorProfile(user.id, body) }),
  { permission: PERMISSIONS.TUTOR_PROFILE_EDIT, bodySchema: updateTutorProfileSchema },
);
