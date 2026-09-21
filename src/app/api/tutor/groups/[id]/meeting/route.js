import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { configureMeetingSchema } from "@/lib/validation/meetings";
import { configureMeeting } from "@/services/meeting.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

/**
 * The joining details for a group session (§27, §41 Phase 2).
 *
 * One room for the whole group, so this configures the session rather than
 * each learner's booking — and it is the same service call a one-to-one lesson
 * makes, with the same ownership check against the loaded record.
 */
export const POST = routeHandler(
  async ({ user, params: p, body }) => ok(await configureMeeting("GROUP", p.id, body, user)),
  {
    permission: PERMISSIONS.BOOKING_MEETING_MANAGE,
    paramsSchema: params,
    bodySchema: configureMeetingSchema,
  },
);

export const DELETE = routeHandler(
  async ({ user, params: p }) =>
    ok(await configureMeeting("GROUP", p.id, { action: "clear" }, user)),
  { permission: PERMISSIONS.BOOKING_MEETING_MANAGE, paramsSchema: params },
);
