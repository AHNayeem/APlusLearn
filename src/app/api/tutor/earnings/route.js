import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { tutorEarnings } from "@/services/payment.service";
import { PERMISSIONS } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => ok(await tutorEarnings(user.id, query)),
  {
    permission: PERMISSIONS.TUTOR_EARNINGS_VIEW,
    querySchema: z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }),
  },
);
