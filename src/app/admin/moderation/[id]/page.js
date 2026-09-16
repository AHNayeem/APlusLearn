import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Flag, ShieldCheck } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, REPORT_STATUS_LABELS, BOOKING_STATUS_LABELS } from "@/constants";
import { getReportedConversation } from "@/services/message.service";
import { NotFoundError } from "@/lib/api/errors";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ConversationModeration } from "@/components/admin/ConversationModeration";
import { formatDate, formatDateTime, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Reported conversation" };
export const dynamic = "force-dynamic";

/**
 * A single reported thread, with the context a moderator needs to judge it:
 * who the two people are, what was said, and what they have booked together.
 *
 * `getReportedConversation` writes the audit entry — opening this page *is*
 * the recorded act of reading two members' private messages (§35).
 */
export default async function AdminReportedConversationPage({ params }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/moderation");
  await connectToDatabase();

  const { id } = await params;

  let data;
  try {
    data = await getReportedConversation(id, user);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { conversation, messages, bookings } = data;
  const learner = conversation.learnerUserId;
  const tutor = conversation.tutorUserId;
  const participantName = (id_) =>
    String(id_) === String(learner?.id) ? learner : String(id_) === String(tutor?.id) ? tutor : null;

  return (
    <DashboardPage>
      <Link
        href="/admin/moderation"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
      >
        <ArrowLeft className="size-4" />
        Back to reports
      </Link>

      <PageHeader
        className="mt-4"
        title="Reported conversation"
        description="Read the thread, decide, and record why. Both are kept."
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warning-700">
                  <Flag className="size-3" />
                  Reported {formatRelative(conversation.reportedAt)} by{" "}
                  {conversation.reportedBy
                    ? `${conversation.reportedBy.firstName} ${conversation.reportedBy.lastName ?? ""}`.trim()
                    : "a member"}
                  {conversation.reportedBy?.role ? ` (${conversation.reportedBy.role.toLowerCase()})` : ""}
                </p>
                <Badge tone="warning" size="sm">
                  {REPORT_STATUS_LABELS[conversation.reportStatus] ?? conversation.reportStatus}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {conversation.reportReason}
              </p>
              {conversation.reportCount > 1 && (
                <p className="mt-2 text-xs font-semibold text-danger-600">
                  This thread has been reported {conversation.reportCount} times.
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="The conversation"
              description={`${messages.length} message${messages.length === 1 ? "" : "s"}, oldest first.`}
            />
            <CardBody className="space-y-3">
              {messages.length === 0 ? (
                <p className="text-sm text-ink-500">This thread has no messages.</p>
              ) : (
                messages.map((message) => {
                  const sender = participantName(message.senderId);
                  const fromTutor = String(message.senderId) === String(tutor?.id);
                  return (
                    <div
                      key={message.id}
                      className={`rounded-xl border p-3 ${
                        fromTutor
                          ? "border-brand-100 bg-brand-50/40"
                          : "border-ink-100 bg-ink-50/60"
                      }`}
                    >
                      <p className="text-xs font-bold text-ink-500">
                        {sender ? `${sender.firstName} ${sender.lastName ?? ""}`.trim() : "Unknown"}
                        <span className="ml-2 font-normal text-ink-400">
                          {formatDateTime(message.createdAt)}
                        </span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                        {message.body}
                      </p>
                    </div>
                  );
                })
              )}
            </CardBody>
          </Card>

          {conversation.moderationHistory?.length > 0 && (
            <Card>
              <CardHeader title="Moderation history" />
              <CardBody className="space-y-3">
                {conversation.moderationHistory.map((entry, index) => (
                  <div key={index} className="border-l-2 border-ink-200 pl-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink-500">
                      {REPORT_STATUS_LABELS[entry.action] ?? entry.action} ·{" "}
                      {formatDateTime(entry.at)}
                      {entry.byId
                        ? ` · ${entry.byId.firstName ?? ""} ${entry.byId.lastName ?? ""}`.trimEnd()
                        : ""}
                    </p>
                    {entry.note && <p className="mt-1 text-sm text-ink-600">{entry.note}</p>}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Participants" />
            <CardBody className="space-y-4 text-sm">
              {[
                { label: "Learner side", person: learner },
                { label: "Tutor", person: tutor },
              ].map(({ label, person }) => (
                <div key={label}>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-400">{label}</p>
                  <p className="font-semibold text-ink-900">
                    {person ? `${person.firstName} ${person.lastName ?? ""}`.trim() : "—"}
                  </p>
                  <p className="text-xs text-ink-500">{person?.email}</p>
                  {person?.id && (
                    <Link
                      href={`/admin/users/${person.id}`}
                      className="text-xs font-semibold text-brand-600 hover:underline"
                    >
                      Open account
                    </Link>
                  )}
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lessons together" />
            <CardBody className="space-y-3 text-sm">
              {bookings.length === 0 ? (
                <p className="text-ink-500">These two have never booked a lesson.</p>
              ) : (
                bookings.map((booking) => (
                  <div key={booking.id}>
                    <p className="font-medium text-ink-800">
                      {booking.courseCode ?? booking.courseName}
                    </p>
                    <p className="text-xs text-ink-500">
                      {formatDate(booking.startAt)} ·{" "}
                      {BOOKING_STATUS_LABELS[booking.status] ?? booking.status} ·{" "}
                      {booking.reference}
                    </p>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Decision"
              description="Closing a report is the record that a person looked at it."
            />
            <CardBody>
              <ConversationModeration conversation={conversation} />
              <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-500">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                Suspending or removing an account is done from the member&rsquo;s page — that
                keeps the decision and the sanction as two separate, separately audited acts.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardPage>
  );
}
