import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { moderateRequestSchema } from "@/lib/validation/engagement";
import { moderateRequest } from "@/services/request.service";
import { PERMISSIONS } from "@/constants";

/** Remove a request from the board, or put one back (§23). */
export const PATCH = routeHandler(
  async ({ user, params, body }) => ok({ request: await moderateRequest(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_REQUEST_MODERATE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: moderateRequestSchema,
  },
);
