import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, REPORT_STATUS, REPORT_STATUS_LABELS } from "@/constants";
import { listReportedConversations } from "@/services/message.service";
import {
  Alert, Badge, EmptyState, LinkTabs, Pagination, Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatRelative, publicName } from "@/lib/utils/format";

export const metadata = { title: "Reported conversations" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "Needs attention" },
  { value: REPORT_STATUS.OPEN, label: "Open" },
  { value: REPORT_STATUS.REVIEWING, label: "Under review" },
  { value: REPORT_STATUS.RESOLVED, label: "Resolved" },
  { value: REPORT_STATUS.DISMISSED, label: "Dismissed" },
];

function tone(status) {
  if (status === REPORT_STATUS.OPEN) return "danger";
  if (status === REPORT_STATUS.REVIEWING) return "warning";
  if (status === REPORT_STATUS.RESOLVED) return "success";
  return "neutral";
}

/**
 * The safeguarding queue (§21, §35).
 *
 * Deliberately a list of *cases*, not of messages — the thread itself opens
 * one at a time on the detail page, and that read is audited.
 */
export default async function AdminModerationPage({ searchParams }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/moderation");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const { items, total, openCount, pageSize } = await listReportedConversations(user, {
    status: status || undefined,
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Reported conversations"
        description="Messages members have asked us to look at. Opening a thread is recorded in the audit log."
      />

      {openCount > 0 && (
        <Alert tone="warning" title={`${openCount} report${openCount === 1 ? "" : "s"} waiting`} className="mt-6">
          Young people use this platform. Reports here are read by a person and closed with a
          decision — resolve or dismiss each one so the queue reflects reality.
        </Alert>
      )}

      <LinkTabs
        className="mt-6"
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/moderation?status=${tab.value}` : "/admin/moderation",
        }))}
      />

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<MessageSquareWarning className="size-7" />}
            title="Nothing reported"
            description={
              status
                ? "No conversations with that status."
                : "No conversation is waiting on moderation."
            }
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <TH>Reported</TH>
              <TH>Participants</TH>
              <TH>Reported by</TH>
              <TH>Reason</TH>
              <TH>Status</TH>
              <TH align="right">Action</TH>
            </THead>
            <TBody>
              {items.map((thread) => (
                <TR key={thread.id}>
                  <TD>
                    <span className="font-semibold text-ink-900">
                      {formatRelative(thread.reportedAt)}
                    </span>
                    {thread.reportCount > 1 && (
                      <span className="block text-xs text-danger-600">
                        Reported {thread.reportCount} times
                      </span>
                    )}
                  </TD>
                  <TD className="text-sm">
                    <span className="block font-medium text-ink-800">
                      {publicName(
                        thread.learnerUserId?.firstName ?? "",
                        thread.learnerUserId?.lastName ?? "",
                      )}
                      {" ↔ "}
                      {publicName(
                        thread.tutorUserId?.firstName ?? "",
                        thread.tutorUserId?.lastName ?? "",
                      )}
                    </span>
                    {thread.bookingId?.reference && (
                      <span className="block text-xs text-ink-500">
                        {thread.bookingId.reference} · {thread.bookingId.courseCode ?? thread.bookingId.courseName}
                      </span>
                    )}
                  </TD>
                  <TD className="text-sm">
                    {thread.reportedBy
                      ? `${thread.reportedBy.firstName} ${thread.reportedBy.lastName ?? ""}`.trim()
                      : "—"}
                    <span className="block text-xs text-ink-500">
                      {thread.reportedBy?.role?.toLowerCase()}
                    </span>
                  </TD>
                  <TD className="max-w-[22rem] text-xs text-ink-600">{thread.reportReason}</TD>
                  <TD>
                    <Badge tone={tone(thread.reportStatus)} size="sm">
                      {REPORT_STATUS_LABELS[thread.reportStatus] ?? thread.reportStatus}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/admin/moderation/${thread.id}`}
                      className="text-sm font-semibold text-brand-600 hover:underline"
                    >
                      Review
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          className="mt-6"
          page={Number(page)}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          label="reports"
          buildHref={(p) =>
            `/admin/moderation?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`
          }
        />
      </div>
    </DashboardPage>
  );
}
