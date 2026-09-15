import { z } from "zod";
import { routeHandler, ok, NotFoundError } from "@/lib/api";
import { reviewApplicationSchema } from "@/lib/validation/tutors";
import { objectId } from "@/lib/validation/common";
import { TutorApplication } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { reviewApplication } from "@/services/tutor.service";
import { listVerificationRecords } from "@/services/verification.service";
import { PERMISSIONS } from "@/constants";

const paramsSchema = z.object({ id: objectId });

export const GET = routeHandler(
  async ({ params }) => {
    const application = await TutorApplication.findById(params.id)
      .populate("userId", "firstName lastName email phone city province createdAt emailVerifiedAt")
      .populate("tutorProfileId")
      .lean();
    if (!application) throw new NotFoundError("That application no longer exists.");

    const records = application.tutorProfileId
      ? await listVerificationRecords(application.tutorProfileId._id)
      : [];

    return ok({ application: toPlain(application), verification: records });
  },
  { permission: PERMISSIONS.ADMIN_TUTOR_REVIEW, paramsSchema },
);

/** Approve, reject or request more information (§16). */
export const POST = routeHandler(
  async ({ user, params, body }) =>
    ok({ application: await reviewApplication(params.id, body, user) }),
  {
    permission: PERMISSIONS.ADMIN_TUTOR_REVIEW,
    paramsSchema,
    bodySchema: reviewApplicationSchema,
  },
);
