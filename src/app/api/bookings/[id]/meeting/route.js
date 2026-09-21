import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { configureMeetingSchema } from "@/lib/validation/meetings";
import { configureMeeting } from "@/services/meeting.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

/**
 * Set, replace, withdraw or remove the joining details on a booked lesson
 * (§27).
 *
 * The permission is held by tutors and administrators and by no learner role,
 * so a student's request is refused by the handler before any service code
 * runs. *Which* lesson a tutor may reach is a separate question, answered in
 * the service against the loaded booking — see `assertManager`.
 */
export const POST = routeHandler(
  async ({ user, params: p, body }) => ok(await configureMeeting("BOOKING", p.id, body, user)),
  {
    permission: PERMISSIONS.BOOKING_MEETING_MANAGE,
    paramsSchema: params,
    bodySchema: configureMeetingSchema,
  },
);

/** Remove the configuration. The same path as `{ action: "clear" }`. */
export const DELETE = routeHandler(
  async ({ user, params: p }) =>
    ok(await configureMeeting("BOOKING", p.id, { action: "clear" }, user)),
  { permission: PERMISSIONS.BOOKING_MEETING_MANAGE, paramsSchema: params },
);
