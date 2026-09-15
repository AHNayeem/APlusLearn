import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listConversations } from "@/services/message.service";
import { PERMISSIONS, FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listConversations(user, {
      ...query,
      includeArchived: query.archived === "true",
    });
    return ok({ conversations: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    feature: FEATURES.MESSAGING,
    permission: PERMISSIONS.MESSAGE_VIEW,
    querySchema: z.object({
      page: z.coerce.number().int().min(1).max(100).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
      archived: z.enum(["true", "false"]).optional(),
    }),
  },
);
