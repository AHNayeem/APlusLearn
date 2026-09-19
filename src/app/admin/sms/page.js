import { MessageSquare, AlertTriangle } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, SMS_STATUS, SMS_STATUS_LABELS, SMS_SKIP_REASON_LABELS,
} from "@/constants";
import { listSmsMessages } from "@/services/sms.service";
import {
  Alert, Badge, Card, CardBody, EmptyState, LinkTabs, Pagination,
  Table, THead, TH, TBody, TR, TD, TableEmpty, StatCard,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Text messages" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: SMS_STATUS.SENT, label: "Sent" },
  { value: SMS_STATUS.FAILED, label: "Failed" },
  { value: SMS_STATUS.SKIPPED, label: "Not sent" },
  { value: SMS_STATUS.SIMULATED, label: "Simulated" },
];

function tone(status) {
  if (status === SMS_STATUS.SENT || status === SMS_STATUS.DELIVERED) return "success";
  if (status === SMS_STATUS.FAILED) return "danger";
  if (status === SMS_STATUS.SIMULATED) return "warning";
  return "neutral";
}

/**
 * The text-message delivery log (§28, §41 Phase 2).
 *
 * Built for the question support actually gets — "why didn't they get a
 * text?" — so messages that were deliberately *not* sent are first-class rows
 * with a reason, not absences. Numbers are masked and message bodies are
 * truncated; one-time codes are never stored at all (§36).
 */
export default async function AdminSmsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/sms");
  await connectToDatabase();

  const { status = "", page = "1", search = "" } = await searchParams;
  const { items, total, pageSize, counts, providerConfigured } = await listSmsMessages({
    status: status || undefined,
    search: search || undefined,
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Text messages"
        description="Every text the platform attempted in the last 30 days, including the ones it deliberately did not send."
      />

      {!providerConfigured && (
        <Alert
          tone="warning"
          title="No SMS provider is configured"
          icon={<AlertTriangle className="size-3" />}
          className="mb-6"
        >
          Messages are recorded and printed to the server console, but no carrier receives them.
          Anything below marked <strong>Simulated</strong> was never actually delivered.
        </Alert>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sent (30 days)" value={counts[SMS_STATUS.SENT] ?? 0} />
        <StatCard label="Failed" value={counts[SMS_STATUS.FAILED] ?? 0} />
        <StatCard label="Not sent" value={counts[SMS_STATUS.SKIPPED] ?? 0} />
        <StatCard label="Simulated" value={counts[SMS_STATUS.SIMULATED] ?? 0} />
      </div>

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/sms?status=${tab.value}` : "/admin/sms",
        }))}
      />

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="size-7" />}
              title="No messages"
              description="Nothing matches this filter yet."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>To</TH>
                  <TH>Recipient</TH>
                  <TH>Message</TH>
                  <TH>Outcome</TH>
                </TR>
              </THead>
              <TBody>
                {items.length === 0 && <TableEmpty colSpan={5}>No messages.</TableEmpty>}
                {items.map((row) => (
                  <TR key={row.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatRelative(row.createdAt)}
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-xs">{row.to}</TD>
                    <TD className="text-xs">
                      {row.userId
                        ? `${row.userId.firstName} ${row.userId.lastName}`
                        : <span className="text-ink-400">—</span>}
                    </TD>
                    <TD className="max-w-sm">
                      <p className="line-clamp-2 text-xs text-ink-600">{row.bodyPreview}</p>
                      <p className="mt-0.5 text-[11px] text-ink-400">
                        {row.notificationType ?? row.kind}
                        {row.segments ? ` · ${row.segments} segment${row.segments === 1 ? "" : "s"}` : ""}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={tone(row.status)} size="sm">
                        {SMS_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                      {row.skipReason && (
                        <p className="mt-1 text-[11px] text-ink-500">
                          {SMS_SKIP_REASON_LABELS[row.skipReason] ?? row.skipReason}
                        </p>
                      )}
                      {row.errorMessage && (
                        <p className="mt-1 text-[11px] text-danger-600">{row.errorMessage}</p>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="messages"
        buildHref={(p) => `/admin/sms?status=${status}&page=${p}`}
      />
    </DashboardPage>
  );
}
