import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { recordAttendanceSchema } from "@/lib/validation/groups";
import { recordAttendance } from "@/services/group.service";
import { PERMISSIONS } from "@/constants";

/**
 * Record who turned up (§41 Phase 2).
 *
 * Attendance drives each learner's own booking to COMPLETED or NO_SHOW, so
 * the platform's existing no-show policy decides the money rather than a
 * second, group-specific rule (§26).
 */
export const POST = routeHandler(
  async ({ user, params, body }) => ok(await recordAttendance(params.id, body, user)),
  {
    permission: PERMISSIONS.BOOKING_COMPLETE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: recordAttendanceSchema,
  },
);
