import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { listAvailableCalendars } from "@/services/calendar.service";
import { PERMISSIONS } from "@/constants";

/** The calendars a connected account can write to, for the picker. */
export const GET = routeHandler(
  async ({ user, params }) => ok(await listAvailableCalendars(params.id, user)),
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT, paramsSchema: z.object({ id: objectId }) },
);
