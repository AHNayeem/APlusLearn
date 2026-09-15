import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import {
  getPayoutAccount, startPayoutOnboarding, completePayoutOnboarding,
} from "@/services/payout.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => ok({ account: await getPayoutAccount(user.id) }),
  { permission: PERMISSIONS.TUTOR_PAYOUT_MANAGE },
);

/**
 * Start or finish payout onboarding. A real provider drives `COMPLETE` from a
 * webhook; the development provider completes on request (§38).
 */
export const POST = routeHandler(
  async ({ user, body }) => {
    const account =
      body.action === "COMPLETE"
        ? await completePayoutOnboarding(user.id)
        : await startPayoutOnboarding(user.id);
    return ok({ account });
  },
  {
    permission: PERMISSIONS.TUTOR_PAYOUT_MANAGE,
    bodySchema: z.object({ action: z.enum(["START", "COMPLETE"]).default("START") }),
  },
);
