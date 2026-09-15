import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getTutorProfileByUserId, getOrCreateApplication } from "@/services/tutor.service";
import { listVerificationRecords } from "@/services/verification.service";
import { Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ApplicationStatusBanner } from "@/components/tutor/ApplicationStatusBanner";
import { VerificationPanel } from "@/components/tutor/VerificationPanel";

export const metadata = { title: "Verification" };
export const dynamic = "force-dynamic";

export default async function TutorVerificationPage({ searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/verification");
  await connectToDatabase();

  const { submitted } = await searchParams;
  const [profile, application] = await Promise.all([
    getTutorProfileByUserId(user.id),
    getOrCreateApplication(user.id),
  ]);

  if (!profile) {
    return (
      <DashboardPage>
        <PageHeader title="Verification" />
        <ApplicationStatusBanner application={application} profile={profile} />
        <EmptyState
          title="Submit your application first"
          description="Verification opens once your tutor application has been submitted."
          action={<Button href="/tutor/onboarding">Continue application</Button>}
        />
      </DashboardPage>
    );
  }

  const records = await listVerificationRecords(profile.id);

  return (
    <DashboardPage>
      <PageHeader
        title="Verification"
        description="The badges on your profile and what's still outstanding."
      />
      <ApplicationStatusBanner application={application} profile={profile} />
      <VerificationPanel records={records} justSubmitted={submitted === "1"} />
    </DashboardPage>
  );
}
