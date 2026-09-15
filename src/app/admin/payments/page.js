import Link from "next/link";
import { CreditCard, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PAYMENT_STATUS, PAYMENT_STATUS_LABELS } from "@/constants";
import { listPayments } from "@/services/payment.service";
import {
  Badge, Button, EmptyState, LinkTabs, Pagination, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RefundButton } from "@/components/admin/RefundButton";
import { formatMoney, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: PAYMENT_STATUS.PAID, label: "Paid" },
  { value: PAYMENT_STATUS.REQUIRES_PAYMENT, label: "Unpaid" },
  { value: PAYMENT_STATUS.REFUNDED, label: "Refunded" },
  { value: PAYMENT_STATUS.FAILED, label: "Failed" },
];

function tone(status) {
  if (status === PAYMENT_STATUS.PAID) return "success";
  if (status === PAYMENT_STATUS.FAILED) return "danger";
  if (status === PAYMENT_STATUS.REFUNDED) return "neutral";
  if (status === PAYMENT_STATUS.PARTIALLY_REFUNDED) return "warning";
  return "warning";
}

export default async function AdminPaymentsPage({ searchParams }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/payments");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const { items, total, pageSize } = await listPayments(user, {
    page: Number(page),
    status: status || undefined,
  });

  const totals = items.reduce(
    (acc, p) => ({
      gross: acc.gross + (p.status === PAYMENT_STATUS.PAID ? p.totalCents : 0),
      commission: acc.commission + (p.status === PAYMENT_STATUS.PAID ? p.commissionCents : 0),
      refunded: acc.refunded + (p.refundedCents ?? 0),
    }),
    { gross: 0, commission: 0, refunded: 0 },
  );

  return (
    <DashboardPage>
      <PageHeader
        title="Payments"
        description="Every transaction, with refunds available where money is still recoverable."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Collected (this page)"
          value={formatMoney(totals.gross, { compact: true })}
          icon={<CreditCard className="size-5" />}
        />
        <StatCard
          label="Commission"
          value={formatMoney(totals.commission, { compact: true })}
        />
        <StatCard label="Refunded" value={formatMoney(totals.refunded, { compact: true })} />
      </div>

      <div className="mt-6">
        <LinkTabs
          activeValue={status}
          tabs={TABS.map((tab) => ({
            ...tab,
            href: tab.value ? `/admin/payments?status=${tab.value}` : "/admin/payments",
          }))}
        />
      </div>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="size-7" />}
            title="No payments match"
            description="Try a different status filter."
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <TH>Lesson</TH>
              <TH>Family</TH>
              <TH>Paid</TH>
              <TH>Method</TH>
              <TH>Status</TH>
              <TH align="right">Amount</TH>
              <TH align="right">Action</TH>
            </THead>
            <TBody>
              {items.map((payment) => (
                <TR key={payment.id}>
                  <TD>
                    <span className="block font-semibold text-ink-900">
                      {payment.bookingId?.courseCode ?? payment.bookingId?.courseName ?? "Lesson"}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {payment.bookingId?.reference}
                    </span>
                  </TD>
                  <TD className="text-sm">
                    {payment.purchaserId ? (
                      <Link
                        href={`/admin/users/${payment.purchaserId.id}`}
                        className="text-brand-600 hover:underline"
                      >
                        {payment.purchaserId.firstName} {payment.purchaserId.lastName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="text-xs">
                    {payment.paidAt ? formatDate(payment.paidAt) : "—"}
                  </TD>
                  <TD className="text-xs">
                    {payment.paymentMethodLast4
                      ? `${payment.paymentMethodBrand} ···· ${payment.paymentMethodLast4}`
                      : "—"}
                  </TD>
                  <TD>
                    <Badge tone={tone(payment.status)} size="sm">
                      {PAYMENT_STATUS_LABELS[payment.status]}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <span className="block font-semibold text-ink-900">
                      {formatMoney(payment.totalCents)}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {formatMoney(payment.commissionCents)} fee
                    </span>
                    {payment.refundedCents > 0 && (
                      <span className="block text-xs text-success-700">
                        −{formatMoney(payment.refundedCents)}
                      </span>
                    )}
                  </TD>
                  <TD align="right">
                    {payment.status === PAYMENT_STATUS.PAID ||
                    payment.status === PAYMENT_STATUS.PARTIALLY_REFUNDED ? (
                      <RefundButton payment={payment} />
                    ) : null}
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
          label="payments"
          buildHref={(p) =>
            `/admin/payments?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`
          }
        />
      </div>
    </DashboardPage>
  );
}
