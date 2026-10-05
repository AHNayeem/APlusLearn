import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { reportRequestSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { reportRequest } from "@/services/request.service";
import { FEATURES } from "@/constants";

/**
 * Report a tutor request to the moderators (R28.24).
 *
 * Open to any signed-in member; the service decides whether this member may
 * see the request at all, refuses the family who posted it, and refuses a
 * second report from the same member while their first is still open.
 */
export const POST = routeHandler(
  async ({ user, params, body }) => ok(await reportRequest(params.id, body, user)),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    auth: true,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: reportRequestSchema,
  },
);
