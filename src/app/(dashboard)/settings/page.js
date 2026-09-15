import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { getUser } from "@/services/user.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { SettingsPanels } from "@/components/dashboard/SettingsPanels";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await enforceRole(LEARNER_ROLES, "/settings");
  await connectToDatabase();
  const user = await getUser(session.id);

  return (
    <DashboardPage>
      <PageHeader title="Settings" description="Your details, notifications and account security." />
      <SettingsPanels user={user} />
    </DashboardPage>
  );
}
