import { routeHandler, ok, created } from "@/lib/api";
import { provinceSchema } from "@/lib/validation/admin";
import { listProvinces, createProvince } from "@/services/curriculum.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async () => ok({ provinces: await listProvinces({ activeOnly: false }) }),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE },
);

export const POST = routeHandler(
  async ({ user, body }) => created({ province: await createProvince(body, user) }),
  { permission: PERMISSIONS.ADMIN_CURRICULUM_MANAGE, bodySchema: provinceSchema },
);
