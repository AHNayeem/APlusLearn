import { routeHandler, ok } from "@/lib/api";
import { reportableStudents } from "@/services/progress.service";
import { PERMISSIONS } from "@/constants";

/** Learners this tutor has actually taught, for the report picker. */
export const GET = routeHandler(
  async ({ user }) => ok(await reportableStudents(user)),
  { permission: PERMISSIONS.PROGRESS_REPORT_WRITE },
);
