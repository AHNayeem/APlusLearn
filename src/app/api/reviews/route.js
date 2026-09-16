import { z } from "zod";
import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { createReviewSchema } from "@/lib/validation/engagement";
import { objectId } from "@/lib/validation/common";
import { listReviews, createReview } from "@/services/review.service";
import { PERMISSIONS, REVIEW_STATUS, FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listReviews(user, query);
    return ok({ reviews: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    feature: FEATURES.REVIEWS,
    permission: PERMISSIONS.REVIEW_VIEW,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
      status: z.enum(Object.values(REVIEW_STATUS)).optional(),
      reported: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
      tutorProfileId: objectId.optional(),
    }),
  },
);

/** Only a completed booking can produce a review (§23, §42). */
export const POST = routeHandler(
  async ({ user, body }) => created({ review: await createReview(body, user) }),
  {
    feature: FEATURES.REVIEWS,
    permission: PERMISSIONS.REVIEW_CREATE,
    verifiedEmail: true,
    bodySchema: createReviewSchema,
  },
);
