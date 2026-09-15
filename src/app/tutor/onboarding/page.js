import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getOrCreateApplication } from "@/services/tutor.service";
import { listGrades, listProvinces, listSubjects } from "@/services/curriculum.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { OnboardingWizard } from "@/components/tutor/onboarding/OnboardingWizard";

export const metadata = {
  title: "Tutor application",
  description: "Complete your APlus Learn tutor application.",
};
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/onboarding");
  await connectToDatabase();

  const [application, grades, provinces, subjects] = await Promise.all([
    getOrCreateApplication(user.id),
    listGrades({ provinceCode: "ON" }),
    listProvinces({ activeOnly: false }),
    listSubjects(),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Your tutor application"
        description="Eleven short steps. Everything saves as you go, so you can finish it in more than one sitting."
      />
      <OnboardingWizard
        application={application}
        grades={grades}
        provinces={provinces}
        subjects={subjects}
      />
    </DashboardPage>
  );
}
