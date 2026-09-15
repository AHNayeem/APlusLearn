import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { listConversations } from "@/services/message.service";
import { Card, CardBody } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ConversationList } from "@/components/messaging/ConversationList";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function TutorMessagesPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/messages");
  await connectToDatabase();

  const { items } = await listConversations(user, { pageSize: 50 });

  return (
    <DashboardPage>
      <PageHeader
        title="Messages"
        description="Families often message before booking. A quick, specific reply is the single best thing you can do for your booking rate."
      />
      <Card>
        <CardBody className="p-0">
          <ConversationList conversations={items} basePath="/tutor/messages" className="p-4" />
        </CardBody>
      </Card>
    </DashboardPage>
  );
}
