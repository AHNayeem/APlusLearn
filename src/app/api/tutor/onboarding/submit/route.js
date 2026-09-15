import { routeHandler, ok } from "@/lib/api";
import { submitApplication } from "@/services/tutor.service";
import { ROLES } from "@/constants";

export const POST = routeHandler(
  async ({ user }) => ok({ application: await submitApplication(user.id) }),
  { roles: ROLES.TUTOR },
);
