import { routeHandler, ok } from "@/lib/api";
import { listOwnVerification } from "@/services/tutor.service";
import { ROLES } from "@/constants";

/**
 * The tutor's own verification records — an applicant's included, so the
 * documents they uploaded inside the wizard are listed before they submit
 * (R13.11).
 */
export const GET = routeHandler(
  async ({ user }) => ok({ records: await listOwnVerification(user.id) }),
  { roles: ROLES.TUTOR },
);
