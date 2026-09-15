import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { listMatches } from "@/services/request.service";
import { PERMISSIONS } from "@/constants";

/** The parent's comparison view of interested and suggested tutors (§22). */
export const GET = routeHandler(
  async ({ user, params }) => ok({ matches: await listMatches(params.id, user) }),
  { permission: PERMISSIONS.REQUEST_VIEW, paramsSchema: z.object({ id: objectId }) },
);
