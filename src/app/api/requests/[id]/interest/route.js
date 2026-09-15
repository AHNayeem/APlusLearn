import { z } from "zod";
import { routeHandler, created } from "@/lib/api";
import { expressInterestSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { expressInterest } from "@/services/request.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => created({ match: await expressInterest(params.id, body, user) }),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_RESPOND,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: expressInterestSchema,
  },
);
