import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { createGroupSessionSchema, tutorGroupQuerySchema } from "@/lib/validation/groups";
import { listSessionsForTutor, createGroupSession } from "@/services/group.service";
import { PERMISSIONS } from "@/constants";

/** A tutor's own group sessions (§41 Phase 2). */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listSessionsForTutor(user, query);
    return ok({ sessions: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.TUTOR_PROFILE_EDIT, querySchema: tutorGroupQuerySchema },
);

/** Create one. It holds no time until it is published. */
export const POST = routeHandler(
  async ({ user, body }) => created({ session: await createGroupSession(body, user) }),
  {
    permission: PERMISSIONS.TUTOR_PROFILE_EDIT,
    verifiedEmail: true,
    bodySchema: createGroupSessionSchema,
  },
);
