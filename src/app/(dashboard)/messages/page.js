import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listConversations, getOrCreateConversation } from "@/services/message.service";
import { redirect } from "next/navigation";
import { Card, CardBody } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ConversationList } from "@/components/messaging/ConversationList";

export const metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/messages");
  await connectToDatabase();

  // Arriving from a tutor profile with ?tutor=… opens (or creates) that thread.
  const { tutor } = await searchParams;
  if (tutor) {
    const conversation = await getOrCreateConversation({
      learnerUserId: user.id,
      tutorProfileId: tutor,
    });
    redirect(`/messages/${conversation._id}`);
  }

  const { items } = await listConversations(user, { pageSize: 50 });

  return (
    <DashboardPage>
      <PageHeader
        title="Messages"
        description="Ask tutors anything before you book — messaging is always free."
      />
      <Card>
        <CardBody className="p-0">
          <ConversationList conversations={items} className="p-4" />
        </CardBody>
      </Card>
    </DashboardPage>
  );
}
