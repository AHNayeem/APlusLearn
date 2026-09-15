import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { respondToMatchSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { respondToMatch } from "@/services/request.service";
import { PERMISSIONS } from "@/constants";

/** Shortlist or decline an interested tutor. */
export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ match: await respondToMatch(params.id, body, user) }),
  {
    permission: PERMISSIONS.REQUEST_VIEW,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: respondToMatchSchema,
  },
);
