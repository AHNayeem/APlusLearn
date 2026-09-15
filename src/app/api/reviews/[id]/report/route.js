import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { reportReviewSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { reportReview } from "@/services/review.service";
import { FEATURES } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok(await reportReview(params.id, body, user)),
  {
    feature: FEATURES.REVIEWS,
    auth: true,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: reportReviewSchema,
  },
);
