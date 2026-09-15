import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { closeRequestSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { closeRequest } from "@/services/request.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ request: await closeRequest(params.id, body, user) }),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_VIEW,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: closeRequestSchema,
  },
);
