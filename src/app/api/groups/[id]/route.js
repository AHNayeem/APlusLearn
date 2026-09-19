import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { leaveWaitlistSchema } from "@/lib/validation/groups";
import { getGroupSession, leaveWaitlist } from "@/services/group.service";

const params = z.object({ id: objectId });

/**
 * One session. The roster and the meeting link are only returned to people
 * entitled to them — the service decides, not the caller (§35, §27).
 */
export const GET = routeHandler(
  async ({ user, params: p }) => ok(await getGroupSession(p.id, user)),
  { paramsSchema: params },
);

/** Give up a place on the waiting list. */
export const DELETE = routeHandler(
  async ({ user, params: p, body }) => ok(await leaveWaitlist(p.id, body, user)),
  { auth: true, paramsSchema: params, bodySchema: leaveWaitlistSchema },
);
