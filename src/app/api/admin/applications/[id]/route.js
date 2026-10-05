import { z } from "zod";
import { routeHandler, ok, NotFoundError } from "@/lib/api";
import { reviewApplicationSchema } from "@/lib/validation/tutors";
import { objectId } from "@/lib/validation/common";
import { getApplicationForReview, reviewApplication } from "@/services/tutor.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ params }) => {
    const review = await getApplicationForReview(params.id);
    if (!review) throw new NotFoundError("That application no longer exists.");
    return ok(review);
  },
  { permission: PERMISSIONS.ADMIN_TUTOR_REVIEW, paramsSchema },
);

/** Approve, reject or request more information (§16). */
export const POST = routeHandler(
  async ({ user, params, body }) =>
    ok({ application: await reviewApplication(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_TUTOR_REVIEW,
    paramsSchema,
    bodySchema: reviewApplicationSchema,
  },
);
