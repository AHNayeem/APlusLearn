import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { badgeMutationSchema } from "@/lib/validation/tutors";
import { objectId } from "@/lib/validation/common";
import { mutateBadge } from "@/services/verification.service";
import { PERMISSIONS } from "@/constants";

/** Grant or revoke a verification badge directly (§16). */
export const POST = routeHandler(
  async ({ user, params, body }) => ok({ profile: await mutateBadge(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_VERIFICATION_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: badgeMutationSchema,
  },
);
