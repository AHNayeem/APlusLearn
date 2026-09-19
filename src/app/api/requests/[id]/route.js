import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import {
  updateTutorRequestSchema,
  cancelRequestSchema,
} from "@/lib/validation/engagement";
import {
  getRequest,
  getRequestForTutor,
  updateTutorRequest,
  cancelRequest,
} from "@/services/request.service";
import { FEATURES, PERMISSIONS, ROLES } from "@/constants";

const params = z.object({ id: objectId });

/**
 * One request.
 *
 * A tutor gets their own view — the brief plus their match state — rather
 * than the owner's record, and the service decides whether they may see it at
 * all. Branching here keeps one URL for one resource while the two audiences
 * read different things from it (§22, §41 Phase 2).
 */
export const GET = routeHandler(
  async ({ user, params: p }) => {
    if (user.role === ROLES.TUTOR) return ok(await getRequestForTutor(p.id, user));
    return ok({ request: await getRequest(p.id, user) });
  },
  { feature: FEATURES.TUTOR_REQUESTS, auth: true, paramsSchema: params },
);

/** Edit an open request; re-runs the matcher against the new brief. */
export const PATCH = routeHandler(
  async ({ user, params: p, body }) => ok(await updateTutorRequest(p.id, body, user)),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_EDIT,
    verifiedEmail: true,
    paramsSchema: params,
    bodySchema: updateTutorRequestSchema,
  },
);

/**
 * Cancel a request. A soft ending, not a delete: the responses tutors wrote
 * stay readable to them and to a moderator (§35).
 */
export const DELETE = routeHandler(
  async ({ user, params: p, body }) =>
    ok({ request: await cancelRequest(p.id, body ?? {}, user) }),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_EDIT,
    paramsSchema: params,
    bodySchema: cancelRequestSchema,
  },
);
