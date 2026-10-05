import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import {
  getOrCreateApplication, listOwnVerification, applicationCourseDetails,
} from "@/services/tutor.service";
import { listProvinces } from "@/services/curriculum.service";
import { getSettings, publicPolicy } from "@/services/settings.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { OnboardingWizard } from "@/components/tutor/onboarding/OnboardingWizard";

export const metadata = {
  title: "Tutor application",
  description: "Complete your APlus Learn tutor application.",
};
export const dynamic = "force-dynamic";

/**
 * The tutor application (§13, §17).
 *
 * No province is named here. The pickers start from the provinces stored in
 * the curriculum — the applicant's own, or the first live one — and load
 * grades, subjects and courses from the public curriculum endpoints, so a
 * province an administrator switches on tomorrow is offered with no code
 * change (R6.5, R13.6).
 */
export default async function OnboardingPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/onboarding");
  await connectToDatabase();

  const application = await getOrCreateApplication(user.id);
  const [provinces, documents, selectedCourses, settings] = await Promise.all([
    listProvinces({ activeOnly: false }),
    listOwnVerification(user.id),
    applicationCourseDetails(application),
    getSettings(),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Your tutor application"
        description="Eleven short steps. Everything saves as you go, so you can finish it in more than one sitting."
      />
      <OnboardingWizard
        application={application}
        provinces={provinces}
        documents={documents}
        selectedCourses={selectedCourses}
        account={{
          firstName: user.firstName,
          lastName: user.lastName,
          avatarUrl: user.avatarUrl ?? null,
        }}
        policy={{
          ...publicPolicy(settings),
          verificationDocumentRetentionDays: settings.verificationDocumentRetentionDays,
        }}
      />
    </DashboardPage>
  );
}
