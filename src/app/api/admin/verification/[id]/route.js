import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { verificationDecisionSchema } from "@/lib/validation/tutors";
import { objectId } from "@/lib/validation/common";
import { decideVerification } from "@/services/verification.service";
import { PERMISSIONS } from "@/constants";

export const POST = routeHandler(
  async ({ user, params, body }) => ok({ record: await decideVerification(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_VERIFICATION_MANAGE,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: verificationDecisionSchema,
  },
);
