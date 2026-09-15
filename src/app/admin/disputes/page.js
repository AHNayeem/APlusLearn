import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, DISPUTE_STATUS, DISPUTE_STATUS_LABELS, DISPUTE_REASON_LABELS,
} from "@/constants";
import { listDisputes } from "@/services/dispute.service";
import {
  Badge, EmptyState, LinkTabs, Pagination, Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Disputes" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: DISPUTE_STATUS.OPEN, label: "Open" },
  { value: DISPUTE_STATUS.UNDER_REVIEW, label: "Under review" },
  { value: DISPUTE_STATUS.RESOLVED_REFUND, label: "Refunded" },
  { value: DISPUTE_STATUS.RESOLVED_NO_REFUND, label: "No refund" },
];

function tone(status) {
  if (status === DISPUTE_STATUS.OPEN) return "danger";
  if (status === DISPUTE_STATUS.UNDER_REVIEW) return "warning";
  return "neutral";
}

export default async function AdminDisputesPage({ searchParams }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/disputes");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const { items, total, pageSize } = await listDisputes(user, {
    status: status || undefined,
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Disputes"
        description="Every dispute raised about a lesson, and how it was resolved."
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/disputes?status=${tab.value}` : "/admin/disputes",
        }))}
      />

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-7" />}
            title="No disputes"
            description="Nothing to adjudicate right now."
          />
        ) : (
          <Table className="min-w-[800px]">
            <THead>
              <TH>Reference</TH>
              <TH>Lesson</TH>
              <TH>Raised by</TH>
              <TH>Reason</TH>
              <TH>Status</TH>
              <TH align="right">Action</TH>
            </THead>
            <TBody>
              {items.map((dispute) => (
                <TR key={dispute.id}>
                  <TD>
                    <span className="font-semibold text-ink-900">{dispute.reference}</span>
                    <span className="block text-xs text-ink-500">
                      {formatRelative(dispute.createdAt)}
                    </span>
                  </TD>
                  <TD>
                    <span className="block font-medium text-ink-800">
                      {dispute.bookingId?.courseCode ?? dispute.bookingId?.courseName}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {dispute.bookingId?.reference} ·{" "}
                      {formatMoney(dispute.bookingId?.price?.totalCents ?? 0)}
                    </span>
                  </TD>
                  <TD className="text-sm">
                    {dispute.raisedBy?.firstName} {dispute.raisedBy?.lastName}
                    <span className="block text-xs text-ink-500">
                      {dispute.raisedByRole?.toLowerCase()}
                    </span>
                  </TD>
                  <TD className="text-xs">{DISPUTE_REASON_LABELS[dispute.reason]}</TD>
                  <TD>
                    <Badge tone={tone(dispute.status)} size="sm">
                      {DISPUTE_STATUS_LABELS[dispute.status]}
                    </Badge>
                    {dispute.refundIssuedCents > 0 && (
                      <span className="mt-1 block text-xs text-success-700">
                        {formatMoney(dispute.refundIssuedCents)} refunded
                      </span>
                    )}
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/admin/disputes/${dispute.id}`}
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
          label="disputes"
          buildHref={(p) =>
            `/admin/disputes?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`
          }
        />
      </div>
    </DashboardPage>
  );
}
