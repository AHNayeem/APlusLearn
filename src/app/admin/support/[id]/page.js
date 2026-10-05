import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, SUPPORT_TICKET_STATUS_LABELS, SUPPORT_TOPIC_LABELS } from "@/constants";
import { getSupportTicket, SUPPORT_TICKET_TRANSITIONS } from "@/services/support.service";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { SupportTicketActions } from "@/components/support/admin/SupportTicketActions";
import { supportStatusTone } from "@/components/support/admin/tone";
import { formatDateTime, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Support ticket", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function personName(person) {
  return person ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "An administrator" : "The enquirer";
}

export default async function AdminSupportTicketPage({ params }) {
  const { id } = await params;
  await enforceRole(ROLES.ADMIN, `/admin/support/${id}`);
  await connectToDatabase();

  const ticket = await getSupportTicket(id).catch(() => null);
  if (!ticket) notFound();

  const account = ticket.userId && typeof ticket.userId === "object" ? ticket.userId : null;

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/admin/support"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All tickets
          </Link>
        }
        title={`Ticket ${ticket.reference}`}
        description={`${SUPPORT_TOPIC_LABELS[ticket.topic]} · received ${formatRelative(ticket.createdAt)}`}
        action={
          <Badge tone={supportStatusTone(ticket.status)}>{SUPPORT_TICKET_STATUS_LABELS[ticket.status]}</Badge>
        }
      />

      {ticket.urgent && (
        <Alert tone="danger" title="Safety report" icon={<ShieldAlert className="size-3" />} className="mb-6">
          Treat this before anything else in the queue. If it describes a child in immediate danger,
          contact the police first, then act on the account from user management.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Message" description={`Sent ${formatDateTime(ticket.createdAt)}`} />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{ticket.message}</p>
              {ticket.path && (
                <p className="mt-4 text-xs text-ink-500">
                  Sent from <code className="rounded bg-ink-50 px-1.5 py-0.5">{ticket.path}</code>
                </p>
              )}
            </CardBody>
          </Card>

          <SupportTicketActions
            ticketId={ticket.id}
            status={ticket.status}
            allowed={SUPPORT_TICKET_TRANSITIONS[ticket.status] ?? []}
          />

          <Card>
            <CardHeader title="Internal notes" description="Only visible to administrators." />
            <CardBody>
              {ticket.notes?.length ? (
                <ul className="space-y-3">
                  {ticket.notes.map((note) => (
                    <li key={note.id ?? note.createdAt} className="rounded-xl bg-ink-50 p-3">
                      <p className="text-xs text-ink-400">
                        {personName(note.authorId)} · {formatDateTime(note.createdAt)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-600">{note.note}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-500">No notes yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="From" />
            <CardBody className="space-y-2 text-sm">
              <p className="font-semibold text-ink-900">{ticket.name}</p>
              <a href={`mailto:${ticket.email}?subject=${encodeURIComponent(`Re: ${ticket.reference}`)}`} className="break-words text-brand-600 hover:underline">
                {ticket.email}
              </a>
              <p className="text-xs text-ink-500">
                {account ? (
                  <>
                    Signed in as a {String(account.role ?? ticket.userRole ?? "").toLowerCase()} ·{" "}
                    <Link href={`/admin/users?q=${encodeURIComponent(account.email ?? ticket.email)}`} className="text-brand-600 hover:underline">
                      Find account
                    </Link>
                  </>
                ) : (
                  "Not signed in — identity is as typed in the form."
                )}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Inbox notification" />
            <CardBody className="text-sm text-ink-600">
              {ticket.notification?.status === "SENT" && "Emailed to the support inbox."}
              {ticket.notification?.status === "FAILED" &&
                `The inbox email failed (${ticket.notification.error ?? "unknown reason"}). The ticket itself is safe — reply from here.`}
              {(!ticket.notification || ticket.notification.status === "PENDING") && "Not attempted yet."}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" />
            <CardBody>
              <ol className="space-y-2 text-xs text-ink-600">
                {(ticket.history ?? []).map((entry, index) => (
                  <li key={index}>
                    <span className="font-semibold text-ink-800">
                      {entry.from
                        ? `${SUPPORT_TICKET_STATUS_LABELS[entry.from]} → ${SUPPORT_TICKET_STATUS_LABELS[entry.to]}`
                        : `Opened`}
                    </span>{" "}
                    · {entry.from ? personName(entry.byId) : "by the enquirer"} · {formatDateTime(entry.at)}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardPage>
  );
}
