import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import {
  getPayoutAccount, startPayoutOnboarding, refreshPayoutAccount,
} from "@/services/payout.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => ok({ account: await getPayoutAccount(user.id) }),
  { permission: PERMISSIONS.TUTOR_PAYOUT_MANAGE },
);

/**
 * Start payout onboarding, or re-read the account's state once the tutor
 * comes back from it (§20, §38).
 *
 * `REFRESH` asks the provider what it actually knows — it cannot grant
 * payout eligibility. Under Stripe that is decided by identity and banking
 * checks; the development provider completes on request so the flow stays
 * testable without credentials.
 */
export const POST = routeHandler(
  async ({ user, body }) => {
    const account =
      body.action === "REFRESH"
        ? await refreshPayoutAccount(user.id)
        : await startPayoutOnboarding(user.id);
    return ok({ account });
  },
  {
    permission: PERMISSIONS.TUTOR_PAYOUT_MANAGE,
    bodySchema: z.object({
      // COMPLETE is the historical name for the same request.
      action: z
        .enum(["START", "REFRESH", "COMPLETE"])
        .default("START")
        .transform((value) => (value === "COMPLETE" ? "REFRESH" : value)),
    }),
  },
);
