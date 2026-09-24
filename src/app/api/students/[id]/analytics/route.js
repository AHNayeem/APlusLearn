import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { analyticsQuerySchema } from "@/lib/validation/admin";
import { studentAnalytics } from "@/services/analytics.service";
import { PERMISSIONS } from "@/constants";

/**
 * One learner's analytics (§24, §41 Phase 3).
 *
 * Unlike `/api/tutor/analytics`, this endpoint *does* name a subject — a
 * parent has several children and a tutor has several students, so there has
 * to be an id. That makes the id the thing to get right: it is never trusted
 * as a claim of access. `studentAnalytics` loads the StudentProfile and
 * decides from the stored `ownerId`, the actor's role, and — for a tutor —
 * the existence of a completed booking between them, which of three views
 * this is. A tutor's view carries no money and no other tutor's teaching.
 *
 * The permission is the door; the service is the lock.
 */
export const GET = routeHandler(
  async ({ user, params, query }) =>
    ok({ analytics: await studentAnalytics(params.id, user, query) }),
  {
    permission: PERMISSIONS.STUDENT_ANALYTICS_VIEW,
    paramsSchema: z.object({ id: objectId }),
    querySchema: analyticsQuerySchema,
  },
);
