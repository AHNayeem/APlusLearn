import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { groupSessionQuerySchema } from "@/lib/validation/groups";
import { listOpenSessions } from "@/services/group.service";

/**
 * Group sessions open for sign-ups.
 *
 * Public, like tutor search: browsing is free, joining is not (§9). The
 * service never returns a private address or the tutor's notes.
 */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listOpenSessions(query);
    return ok({ sessions: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { querySchema: groupSessionQuerySchema },
);
