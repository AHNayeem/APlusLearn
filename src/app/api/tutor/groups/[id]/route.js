import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { updateGroupSessionSchema, cancelGroupSessionSchema } from "@/lib/validation/groups";
import {
  updateGroupSession,
  publishGroupSession,
  cancelGroupSession,
} from "@/services/group.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

/** Edit. Time, price and format lock once somebody has paid to be there. */
export const PATCH = routeHandler(
  async ({ user, params: p, body }) => ok({ session: await updateGroupSession(p.id, body, user) }),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    paramsSchema: params,
    bodySchema: updateGroupSessionSchema,
  },
);

/**
 * Publish — the moment the session reserves the tutor's time, and the moment
 * the availability rules are checked (§18).
 */
export const POST = routeHandler(
  async ({ user, params: p }) => ok({ session: await publishGroupSession(p.id, user) }),
  { permission: PERMISSIONS.TUTOR_PROFILE_EDIT, verifiedEmail: true, paramsSchema: params },
);

/** Cancel it. Everybody who paid is refunded in full, whatever the notice. */
export const DELETE = routeHandler(
  async ({ user, params: p, body }) =>
    ok(await cancelGroupSession(p.id, body ?? {}, user)),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    paramsSchema: params,
    bodySchema: cancelGroupSessionSchema,
  },
);
