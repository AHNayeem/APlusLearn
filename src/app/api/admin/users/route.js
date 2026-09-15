import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { adminUserQuerySchema } from "@/lib/validation/admin";
import { listUsers } from "@/services/user.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ query }) => {
    const { items, total, page, pageSize } = await listUsers(query);
    return ok({ users: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  { permission: PERMISSIONS.ADMIN_USER_MANAGE, querySchema: adminUserQuerySchema },
);
