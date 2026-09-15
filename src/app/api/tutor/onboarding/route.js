import { routeHandler, ok, ValidationError, zodToDetails } from "@/lib/api";
import { saveOnboardingStepSchema, onboardingStepSchemas } from "@/lib/validation/tutors";
import { getOrCreateApplication, saveOnboardingStep } from "@/services/tutor.service";
import { ROLES } from "@/constants";

export const GET = routeHandler(
  async ({ user }) => ok({ application: await getOrCreateApplication(user.id) }),
  { roles: ROLES.TUTOR },
);

/**
 * Save one step. The step's own schema runs here so a partially-complete
 * application still cannot contain invalid data (§17, §37).
 */
export const POST = routeHandler(
  async ({ user, body }) => {
    const schema = onboardingStepSchemas[body.step];
    const result = schema.safeParse(body.data);
    if (!result.success) throw new ValidationError(zodToDetails(result.error));

    const application = await saveOnboardingStep(user.id, {
      step: body.step,
      data: result.data,
    });
    return ok({ application });
  },
  { roles: ROLES.TUTOR, bodySchema: saveOnboardingStepSchema },
);
