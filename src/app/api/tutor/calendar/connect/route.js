import { z } from "zod";
import { routeHandler, created } from "@/lib/api";
import { beginConnection } from "@/services/calendar.service";
import { CALENDAR_PROVIDERS, PERMISSIONS } from "@/constants";

/**
 * Start a calendar connection (§18, §41 Phase 2).
 *
 * Returns the provider's consent URL rather than redirecting, so the browser
 * navigates from a click the person made. The `state` inside that URL is
 * signed and bound to this session — the callback will not accept a code
 * presented with anything else (§36).
 */
export const POST = routeHandler(
  async ({ user, body }) => created(await beginConnection(user, body)),
  {
    permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT,
    verifiedEmail: true,
    bodySchema: z.object({ provider: z.enum(Object.values(CALENDAR_PROVIDERS)) }),
  },
);
