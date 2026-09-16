import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { reportedConversationQuerySchema } from "@/lib/validation/engagement";
import { listReportedConversations } from "@/services/message.service";
import { PERMISSIONS } from "@/constants";

/**
 * The reported-conversation queue (§21).
 *
 * Triage only — no message bodies are returned here. A moderator opens a
 * thread one at a time, and that read is audited.
 */
export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, openCount, page, pageSize } = await listReportedConversations(
      user,
      query,
    );
    return ok(
      { conversations: items, openCount },
      { meta: paginationMeta({ page, pageSize, total }) },
    );
  },
  {
    permission: PERMISSIONS.ADMIN_MESSAGE_MODERATE,
    querySchema: reportedConversationQuerySchema,
  },
);
