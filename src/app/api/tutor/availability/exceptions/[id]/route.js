import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { removeException } from "@/services/availability.service";
import { PERMISSIONS } from "@/constants";

export const DELETE = routeHandler(
  async ({ user, params }) => ok({ availability: await removeException(user.id, params.id) }),
  { permission: PERMISSIONS.TUTOR_AVAILABILITY_EDIT, paramsSchema: z.object({ id: objectId }) },
);
