import { notFound, redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { objectId } from "@/lib/validation/common";
import { ROLES } from "@/constants";
import { tutorBookingThread } from "@/services/message.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { MessageFamilyPanel } from "@/components/messaging/MessageFamilyPanel";

export const metadata = { title: "Message family", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * "Message family", from one of the tutor's bookings (R17.1, R23.6).
 *
 * The booking is the tutor's only way to reach a family first, so this page
 * is keyed by it: the service checks it is this tutor's booking and that the
 * lesson was really arranged, and the family is whoever bought it. A thread
 * that already exists is simply opened.
 */
export default async function TutorNewMessagePage({ searchParams }) {
  const { booking: bookingId } = await searchParams;
  const user = await enforceRole(
    ROLES.TUTOR,
    `/tutor/messages/new${bookingId ? `?booking=${encodeURIComponent(bookingId)}` : ""}`,
  );
  await connectToDatabase();

  if (!objectId.safeParse(bookingId).success) notFound();
  const thread = await tutorBookingThread(bookingId, user).catch(() => null);
  if (!thread) notFound();
  if (thread.conversationId) redirect(`/tutor/messages/${thread.conversationId}`);

  return (
    <DashboardPage>
      <PageHeader
        title="Message family"
        description="Start a conversation about this lesson. The family is notified and can reply from their messages."
      />
      <MessageFamilyPanel booking={thread.booking} canMessage={thread.canMessage} />
    </DashboardPage>
  );
}
