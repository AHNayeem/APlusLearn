import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getTutorProfileByUserId, getOrCreateApplication } from "@/services/tutor.service";
import { Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ApplicationStatusBanner } from "@/components/tutor/ApplicationStatusBanner";
import { ProfileEditor } from "@/components/tutor/ProfileEditor";

export const metadata = { title: "My profile" };
export const dynamic = "force-dynamic";

export default async function TutorProfilePage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/profile");
  await connectToDatabase();

  const [profile, application] = await Promise.all([
    getTutorProfileByUserId(user.id),
    getOrCreateApplication(user.id),
  ]);

  if (!profile) {
    return (
      <DashboardPage>
        <PageHeader title="My profile" />
        <ApplicationStatusBanner application={application} profile={profile} />
        <EmptyState
          title="No profile yet"
          description="Your public profile is created when you submit your application."
          action={<Button href="/tutor/onboarding">Continue application</Button>}
        />
      </DashboardPage>
    );
  }

  return (
    <DashboardPage>
      <PageHeader
        title="My profile"
        description="What families see when they find you in search."
      />
      <ApplicationStatusBanner application={application} profile={profile} />
      <ProfileEditor profile={profile} />
    </DashboardPage>
  );
}
