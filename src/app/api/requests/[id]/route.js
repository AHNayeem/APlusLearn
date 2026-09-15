import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getRequest } from "@/services/request.service";
import { FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ user, params }) => ok({ request: await getRequest(params.id, user) }),
  { feature: FEATURES.TUTOR_REQUESTS, auth: true, paramsSchema: z.object({ id: objectId }) },
);
