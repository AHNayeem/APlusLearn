import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { getRequest } from "@/services/request.service";

export const GET = routeHandler(
  async ({ user, params }) => ok({ request: await getRequest(params.id, user) }),
  { auth: true, paramsSchema: z.object({ id: objectId }) },
);
