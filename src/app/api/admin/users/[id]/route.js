import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { adminUserActionSchema } from "@/lib/validation/admin";
import { objectId } from "@/lib/validation/common";
import { getUserDetail, adminUserAction } from "@/services/user.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

export const GET = routeHandler(async ({ params }) => ok(await getUserDetail(params.id)), {
  permission: PERMISSIONS.ADMIN_USER_MANAGE,
  paramsSchema,
});

export const POST = routeHandler(
  async ({ request, user, params, body }) =>
    ok({ user: await adminUserAction(params.id, body, user, request) }),
  { permission: PERMISSIONS.ADMIN_USER_MANAGE, paramsSchema, bodySchema: adminUserActionSchema },
);
