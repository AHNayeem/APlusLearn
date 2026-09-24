import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { lookupReferralCode } from "@/services/referral.service";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * Check a referral code from the registration form (§41 Phase 2).
 *
 * Public, because it is used before an account exists — and therefore rate
 * limited, and deliberately uninformative about why a code failed. Answering
 * "no such code" versus "that account is suspended" would turn this into a
 * way of enumerating who is on the platform (§36).
 */
export const GET = routeHandler(
  async ({ params, request }) => {
    await enforceRateLimit(clientKey(request, "referral-code"), { limit: 20, windowMs: 60_000 });
    return ok(await lookupReferralCode(params.code));
  },
  {
    paramsSchema: z.object({
      code: z.string().trim().toUpperCase().min(4).max(16),
    }),
  },
);
