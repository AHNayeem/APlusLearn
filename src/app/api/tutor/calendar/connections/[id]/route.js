import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { updateCalendarConnectionSchema } from "@/lib/validation/tutors";
import { updateConnection, disconnectCalendar, syncConnection } from "@/services/calendar.service";
import { PERMISSIONS } from "@/constants";

const params = z.object({ id: objectId });

/** Change the calendar in use, or which directions sync. */
export const PATCH = routeHandler(
  async ({ user, params: p, body }) =>
    ok({ connection: await updateConnection(p.id, body, user) }),
  {
    permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT,
    paramsSchema: params,
    bodySchema: updateCalendarConnectionSchema,
  },
);

/** Refresh busy periods now, rather than waiting for the sweep. */
export const POST = routeHandler(
  async ({ user, params: p }) => {
    // Ownership is proved by loading the record through the same guard the
    // other operations use, before anything is refreshed.
    await updateConnection(p.id, {}, user);
    return ok(await syncConnection(p.id));
  },
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT, paramsSchema: params },
);

/**
 * Disconnect: the lessons we wrote are removed from the calendar, the
 * provider is asked to forget us, and the stored tokens are destroyed.
 */
export const DELETE = routeHandler(
  async ({ user, params: p }) => ok(await disconnectCalendar(p.id, user)),
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT, paramsSchema: params },
);
