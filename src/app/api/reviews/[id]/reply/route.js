import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { replyToReviewSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { replyToReview } from "@/services/review.service";
import { ROLES, FEATURES } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ review: await replyToReview(params.id, body, user) }),
  {
    feature: FEATURES.REVIEWS,
    roles: ROLES.TUTOR,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: replyToReviewSchema,
  },
);
