import { routeHandler, ok } from "@/lib/api";
import { ROLES } from "@/constants";
import { listTutorRoster } from "@/services/student.service";

/**
 * The tutor's student roster (§23). Only learners with a real lesson
 * relationship appear, and a minor arrives as a first name and initial —
 * the surname never leaves the server (§30).
 */
export const GET = routeHandler(
  async ({ user }) => ok({ students: await listTutorRoster(user) }),
  { roles: ROLES.TUTOR },
);
