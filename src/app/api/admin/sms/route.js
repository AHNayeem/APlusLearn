import { z } from "zod";
import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { listSmsMessages } from "@/services/sms.service";
import { PERMISSIONS, SMS_STATUS } from "@/constants";

/**
 * The text-message delivery log (§28, §41 Phase 2).
 *
 * Admin-only, and numbers are masked even here: support needs to recognise a
 * number in a conversation, not to be able to dial it out of a log (§36).
 */
export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize, counts, providerConfigured } =
      await listSmsMessages(query);
    return ok(
      { messages: items, counts, providerConfigured },
      { meta: paginationMeta({ page, pageSize, total }) },
    );
  },
  {
    permission: PERMISSIONS.ADMIN_ANALYTICS_VIEW,
    querySchema: z.object({
      status: z.enum(Object.values(SMS_STATUS)).optional(),
      kind: z.enum(["NOTIFICATION", "VERIFICATION"]).optional(),
      search: z.string().trim().max(20).optional(),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);
