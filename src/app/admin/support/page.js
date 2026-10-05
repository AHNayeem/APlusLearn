import Link from "next/link";
import { LifeBuoy, ShieldAlert, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, SUPPORT_TICKET_STATUS, SUPPORT_TICKET_STATUS_LABELS, SUPPORT_TOPICS, SUPPORT_TOPIC_LABELS,
} from "@/constants";
import { listSupportTickets } from "@/services/support.service";
import { supportTicketQuerySchema } from "@/lib/validation/admin";
import {
  Alert, Badge, Button, EmptyState, LinkTabs, Pagination, Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatRelative, truncate } from "@/lib/utils/format";
import { supportStatusTone } from "@/components/support/admin/tone";

export const metadata = { title: "Support tickets", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const FIELD =
  "h-10 w-full rounded-xl border-0 bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none";

/**
 * The support queue (§33, R28.20).
 *
 * Every enquiry from the support form and the floating launcher lands here
 * before any email is sent, so this — not the inbox — is the list of what is
 * still waiting for an answer. Safety reports sort to the top of whichever
 * view is open and are marked, because the support page promises they are
 * acted on first.
 */
export default async function AdminSupportPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/support");
  await connectToDatabase();

  const parsed = supportTicketQuerySchema.safeParse(await searchParams);
  const params = parsed.success ? parsed.data : supportTicketQuerySchema.parse({});

  const { items, total, page, pageSize, counts } = await listSupportTickets(params);

  const hrefWith = (changes) => {
    const query = new URLSearchParams();
    const next = { status: params.status, topic: params.topic, q: params.q, ...changes };
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, String(value));
    const qs = query.toString();
    return qs ? `/admin/support?${qs}` : "/admin/support";
  };

  return (
    <DashboardPage>
      <PageHeader
        title="Support tickets"
        description="Every enquiry sent through the support form, newest first — safety reports always on top."
      />

      {counts.urgentOpen > 0 && (
        <Alert
          tone="danger"
          title={`${counts.urgentOpen} open safety ${counts.urgentOpen === 1 ? "report" : "reports"}`}
          icon={<ShieldAlert className="size-3" />}
          className="mb-6"
          action={
            <Button href={hrefWith({ topic: SUPPORT_TOPICS.SAFETY, status: undefined, page: undefined })} size="sm">
              Show them
            </Button>
          }
        >
          Safety reports come before everything else in this queue.
        </Alert>
      )}

      <LinkTabs
        activeValue={params.status ?? ""}
        tabs={[
          { value: "", label: "All", count: counts.all, href: hrefWith({ status: undefined, page: undefined }) },
          ...Object.values(SUPPORT_TICKET_STATUS).map((status) => ({
            value: status,
            label: SUPPORT_TICKET_STATUS_LABELS[status],
            count: counts.status[status],
            href: hrefWith({ status, page: undefined }),
          })),
        ]}
      />

      <form method="get" action="/admin/support" className="mt-6 grid gap-3 sm:grid-cols-[14rem_1fr_auto]">
        {params.status && <input type="hidden" name="status" value={params.status} />}
        <label className="sr-only" htmlFor="support-topic-filter">Topic</label>
        <select id="support-topic-filter" name="topic" defaultValue={params.topic ?? ""} className={FIELD}>
          <option value="">All topics</option>
          {Object.values(SUPPORT_TOPICS).map((topic) => (
            <option key={topic} value={topic}>
              {SUPPORT_TOPIC_LABELS[topic]} ({counts.topic[topic] ?? 0})
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="support-q">Search</label>
        <input
          id="support-q"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Reference, name or email"
          className={FIELD}
        />
        <Button type="submit" variant="secondary" iconLeft={<Search className="size-4" />}>
          Filter
        </Button>
      </form>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="size-7" />}
            title="No tickets here"
            description="Nothing matches this view."
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <TH>Reference</TH>
              <TH>From</TH>
              <TH>Topic</TH>
              <TH>Message</TH>
              <TH>Status</TH>
              <TH align="right">Action</TH>
            </THead>
            <TBody>
              {items.map((ticket) => (
                <TR key={ticket.id} className={ticket.urgent ? "bg-danger-50/60" : undefined}>
                  <TD>
                    <span className="font-semibold text-ink-900">{ticket.reference}</span>
                    <span className="block text-xs text-ink-500">{formatRelative(ticket.createdAt)}</span>
                  </TD>
                  <TD className="text-sm">
                    {ticket.name}
                    <span className="block text-xs text-ink-500">
                      {ticket.userRole ? ticket.userRole.toLowerCase() : "guest"} · {ticket.email}
                    </span>
                  </TD>
                  <TD>
                    {ticket.urgent ? (
                      <Badge tone="danger" size="sm" icon={<ShieldAlert className="size-3" />}>
                        {SUPPORT_TOPIC_LABELS[ticket.topic]}
                      </Badge>
                    ) : (
                      <span className="text-xs">{SUPPORT_TOPIC_LABELS[ticket.topic]}</span>
                    )}
                  </TD>
                  <TD className="max-w-xs text-xs text-ink-600">{truncate(ticket.message, 110)}</TD>
                  <TD>
                    <Badge tone={supportStatusTone(ticket.status)} size="sm">
                      {SUPPORT_TICKET_STATUS_LABELS[ticket.status]}
                    </Badge>
                    {ticket.notification?.status === "FAILED" && (
                      <span className="mt-1 block text-xs text-warning-700">Inbox email failed</span>
                    )}
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/admin/support/${ticket.id}`}
                      className="text-sm font-semibold text-brand-600 hover:underline"
                    >
                      Open
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          className="mt-6"
          page={page}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          label="tickets"
          buildHref={(p) => hrefWith({ page: p })}
        />
      </div>
    </DashboardPage>
  );
}
