import { z } from "zod";
import { routeHandler, created } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { inviteTutorsSchema } from "@/lib/validation/engagement";
import { inviteTutors } from "@/services/request.service";
import { FEATURES, PERMISSIONS } from "@/constants";

/**
 * Invite named tutors to a request (§41 Phase 2).
 *
 * The only route into an INVITE_ONLY request. Eligibility is re-checked in
 * the service for every tutor named, so an invitation can never put an
 * unapproved or out-of-area profile in front of a family.
 */
export const POST = routeHandler(
  async ({ user, params, body }) => created(await inviteTutors(params.id, body, user)),
  {
    feature: FEATURES.TUTOR_REQUESTS,
    permission: PERMISSIONS.REQUEST_EDIT,
    verifiedEmail: true,
    paramsSchema: z.object({ id: objectId }),
    bodySchema: inviteTutorsSchema,
  },
);
