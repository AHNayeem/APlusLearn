import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { setTutorSearchable } from "@/services/tutor.service";
import { PERMISSIONS } from "@/constants";

/** Suspend or restore a tutor's visibility in search (§42). */
export const POST = routeHandler(
  async ({ user, params, body }) =>
    ok({ profile: await setTutorSearchable(params.id, body.searchable, user, body.reason) }),
  {
    permission: PERMISSIONS.ADMIN_TUTOR_REVIEW,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: z
      .object({ searchable: z.boolean(), reason: z.string().trim().max(600).optional() })
      .refine((d) => d.searchable || (d.reason?.length ?? 0) >= 10, {
        message: "Record why this tutor is being removed from search.",
        path: ["reason"],
      }),
  },
);
