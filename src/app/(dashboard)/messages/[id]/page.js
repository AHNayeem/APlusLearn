import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import {
  listConversations, getConversation, conversationBookings,
} from "@/services/message.service";
import { Card, CardBody } from "@/components/ui";
import { DashboardPage } from "@/components/layout/DashboardShell";
import { ConversationList } from "@/components/messaging/ConversationList";
import { ConversationView } from "@/components/messaging/ConversationView";

export const metadata = { title: "Messages", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/messages/${id}`);
  await connectToDatabase();

  const [thread, bookings, inbox] = await Promise.all([
    getConversation(id, user, { pageSize: 60 }).catch(() => null),
    conversationBookings(id, user).catch(() => []),
    listConversations(user, { pageSize: 50 }),
  ]);

  if (!thread) notFound();

  return (
    <DashboardPage>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
        <Card className="hidden lg:block">
          <CardBody className="max-h-[calc(100dvh-10rem)] overflow-y-auto p-0">
            <ConversationList conversations={inbox.items} activeId={id} />
          </CardBody>
        </Card>

        <ConversationView
          conversation={thread.conversation}
          messages={thread.messages}
          bookings={bookings}
          viewerId={user.id}
        />
      </div>
    </DashboardPage>
  );
}
