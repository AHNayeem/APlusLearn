import { routeHandler, ok } from "@/lib/api";
import { referralSummary } from "@/services/referral.service";

/** A person's own referral code, stats and the people who joined with it. */
export const GET = routeHandler(async ({ user }) => ok(await referralSummary(user)), {
  auth: true,
});
