import { routeHandler, ok } from "@/lib/api";
import { listConnections } from "@/services/calendar.service";
import { PERMISSIONS } from "@/constants";

/** A tutor's own calendar connections. Never carries a token (§36). */
export const GET = routeHandler(
  async ({ user }) => ok(await listConnections(user.id)),
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT },
);
