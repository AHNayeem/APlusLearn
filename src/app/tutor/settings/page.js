import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { getUser } from "@/services/user.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { SettingsPanels } from "@/components/dashboard/SettingsPanels";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function TutorSettingsPage() {
  const session = await enforceRole(ROLES.TUTOR, "/tutor/settings");
  await connectToDatabase();
  const user = await getUser(session.id);

  return (
    <DashboardPage>
      <PageHeader
        title="Settings"
        description="Your details, notifications and account security. Teaching details live on your profile."
      />
      <SettingsPanels user={user} />
    </DashboardPage>
  );
}
