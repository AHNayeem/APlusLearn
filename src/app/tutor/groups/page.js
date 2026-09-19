import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, MEETING_PROVIDERS } from "@/constants";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import { listSessionsForTutor } from "@/services/group.service";
import { getSettings } from "@/services/settings.service";
import { Alert, Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { GroupSessionManager } from "@/components/groups/GroupSessionManager";

export const metadata = { title: "Group sessions" };
export const dynamic = "force-dynamic";

/** A tutor's group sessions (§41 Phase 2). */
export default async function TutorGroupsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/groups");
  await connectToDatabase();

  const profile = await getTutorProfileByUserId(user.id);
  if (!profile) {
    return (
      <DashboardPage>
        <PageHeader title="Group sessions" />
        <EmptyState
          title="Finish your application first"
          description="Group sessions open once your profile has been approved."
          action={<Button href="/tutor/onboarding">Continue application</Button>}
        />
      </DashboardPage>
    );
  }

  const [{ items }, settings] = await Promise.all([
    listSessionsForTutor(user, {}),
    getSettings(),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Group sessions"
        description="Teach several learners at once — a full session usually earns more than the same hour taught one to one."
      />

      {settings.groups?.enabled === false && (
        <Alert tone="warning" title="Group sessions are switched off platform-wide" className="mb-6">
          Sessions already running are unaffected, but nobody can create or join a new one.
        </Alert>
      )}

      {!profile.isSearchable && (
        <Alert tone="warning" title="Your profile needs approval first" className="mb-6">
          You can publish group sessions once our team has approved your profile.
        </Alert>
      )}

      <div className="max-w-3xl">
        <GroupSessionManager
          initial={items}
          courses={profile.courses ?? []}
          meetingProviders={
            profile.onlineMeetingProviders?.length
              ? profile.onlineMeetingProviders
              : [MEETING_PROVIDERS.ZOOM]
          }
          lessonModes={profile.lessonModes ?? []}
        />
      </div>
    </DashboardPage>
  );
}
