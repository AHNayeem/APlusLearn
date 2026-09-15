import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { moderateReviewSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { moderateReview } from "@/services/review.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ review: await moderateReview(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_REVIEW_MODERATE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: moderateReviewSchema,
  },
);
