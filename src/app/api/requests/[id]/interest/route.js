import { z } from "zod";
import { routeHandler, created, ok } from "@/lib/api";
import {
  expressInterestSchema,
  withdrawFromRequestSchema,
} from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { expressInterest, withdrawFromRequest } from "@/services/request.service";
import { PERMISSIONS, FEATURES } from "@/constants";

const params = z.object({ id: objectId });

export const POST = routeHandler(
  async ({ user, params: p, body }) => created({ match: await expressInterest(p.id, body, user) }),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_RESPOND,
    paramsSchema: params,
    bodySchema: expressInterestSchema,
  },
);

/**
 * A tutor steps back: withdrawing a pitch they made, or declining an
 * invitation they were sent. Both are recorded rather than erased, so the
 * family sees an answer instead of silence (§22).
 */
export const DELETE = routeHandler(
  async ({ user, params: p, body }) =>
    ok({ match: await withdrawFromRequest(p.id, body ?? {}, user) }),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_RESPOND,
    paramsSchema: params,
    bodySchema: withdrawFromRequestSchema,
  },
);
