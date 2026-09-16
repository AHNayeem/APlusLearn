import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { listReviews } from "@/services/review.service";
import { REVIEW_STATUS, PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listReviews(user, query);
    return ok({ reviews: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    permission: PERMISSIONS.ADMIN_REVIEW_MODERATE,
    querySchema: z.object({
      status: z.enum(Object.values(REVIEW_STATUS)).optional(),
      /** The moderation queue: reviews with an open report case. */
      reported: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
      tutorProfileId: objectId.optional(),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);
