import { routeHandler, ok } from "@/lib/api";
import { listVerificationRecords } from "@/services/verification.service";
import { requireTutorProfile } from "@/services/tutor.service";
import { ROLES } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => {
    const profile = await requireTutorProfile(user.id);
    return ok({ records: await listVerificationRecords(profile.id) });
  },
  { roles: ROLES.TUTOR },
);
