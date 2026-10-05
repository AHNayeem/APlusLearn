import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { adminAccountActionSchema, adminUserDetailQuerySchema } from "@/lib/validation/admin-users";
import { objectId } from "@/lib/validation/common";
import { getUserDetail, adminUserAction } from "@/services/user.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

/** One account and its paged history (R28.3) — never message content. */
export const GET = routeHandler(
  async ({ params, query }) => ok(await getUserDetail(params.id, query)),
  { permission: PERMISSIONS.ADMIN_USER_MANAGE, paramsSchema, querySchema: adminUserDetailQuerySchema },
);

/** Suspend, ban, restore, verify, sign out or delete (anonymise) an account. */
export const POST = routeHandler(
  async ({ request, user, params, body }) =>
    ok({ user: await adminUserAction(params.id, body, user, request) }),
  { permission: PERMISSIONS.ADMIN_USER_MANAGE, paramsSchema, bodySchema: adminAccountActionSchema },
);
