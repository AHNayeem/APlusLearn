import { z } from "zod";
import { routeHandler, created } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { joinGroupSessionSchema } from "@/lib/validation/groups";
import { joinGroupSession } from "@/services/group.service";
import { PERMISSIONS } from "@/constants";

/**
 * Take a seat (§41 Phase 2).
 *
 * The seat is claimed atomically before any booking or payment exists, so
 * concurrent joins cannot overbook and nobody is charged for a seat that was
 * not there. A full session puts the learner on the waiting list instead,
 * which costs nothing.
 */
export const POST = routeHandler(
  async ({ user, params, body }) => created(await joinGroupSession(params.id, body, user)),
  {
    permission: PERMISSIONS.BOOKING_CREATE,
    verifiedEmail: true,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: joinGroupSessionSchema,
  },
);
