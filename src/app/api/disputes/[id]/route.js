import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getDispute } from "@/services/dispute.service";

export const GET = routeHandler(
  async ({ user, params }) => ok({ dispute: await getDispute(params.id, user) }),
  { auth: true, paramsSchema: z.object({ id: objectId }) },
);
