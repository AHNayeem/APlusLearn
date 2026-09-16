import { z } from "zod";
import { routeHandler, ok, created, paginationMeta } from "@/lib/api";
import { createTutorRequestSchema } from "@/lib/validation/engagement";
import { listRequests, createTutorRequest } from "@/services/request.service";
import { PERMISSIONS, REQUEST_STATUS, FEATURES } from "@/constants";

export const GET = routeHandler(
  async ({ user, query }) => {
    const { items, total, page, pageSize } = await listRequests(user, query);
    return ok({ requests: items }, { meta: paginationMeta({ page, pageSize, total }) });
  },
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_VIEW,
    querySchema: z.object({
      status: z.enum(Object.values(REQUEST_STATUS)).optional(),
      page: z.coerce.number().int().min(1).max(200).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).optional(),
    }),
  },
);

/** Posting a request runs the matching service immediately (§22). */
export const POST = routeHandler(
  async ({ user, body }) => created(await createTutorRequest(body, user)),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_CREATE,
    verifiedEmail: true,
    bodySchema: createTutorRequestSchema,
  },
);
