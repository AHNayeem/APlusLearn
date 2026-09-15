import Link from "next/link";
import { CreditCard, Receipt } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, PAYMENT_STATUS, PAYMENT_STATUS_LABELS } from "@/constants";
import { listPayments } from "@/services/payment.service";
import {
  Badge, Button, EmptyState, Pagination, StatCard, Table, THead, TH, TBody, TR, TD, TableEmpty,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

function statusTone(status) {
  if (status === PAYMENT_STATUS.PAID) return "success";
  if (status === PAYMENT_STATUS.REFUNDED) return "neutral";
  if (status === PAYMENT_STATUS.PARTIALLY_REFUNDED) return "warning";
  if (status === PAYMENT_STATUS.FAILED) return "danger";
  return "warning";
}

export default async function PaymentsPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/payments");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize } = await listPayments(user, { page: Number(page) });

  const totals = items.reduce(
    (acc, p) => ({
      paid: acc.paid + (p.status === PAYMENT_STATUS.PAID ? p.totalCents : 0),
      refunded: acc.refunded + (p.refundedCents ?? 0),
    }),
    { paid: 0, refunded: 0 },
  );

  return (
    <DashboardPage>
      <PageHeader
        title="Payments"
        description="Every charge, refund and receipt in one place."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Paid this page"
          value={formatMoney(totals.paid)}
          icon={<CreditCard className="size-5" />}
        />
        <StatCard
          label="Refunded"
          value={formatMoney(totals.refunded)}
          icon={<Receipt className="size-5" />}
        />
        <StatCard label="Transactions" value={total} />
      </div>

      <div className="mt-6">
        {items.length === 0 ? (
          <EmptyState
            icon={<CreditCard className="size-7" />}
            title="No payments yet"
            description="Once you book a lesson, the charge and its receipt appear here."
            action={<Button href="/find-a-tutor">Find a tutor</Button>}
          />
        ) : (
          <Table>
            <THead>
              <TH>Lesson</TH>
              <TH>Date</TH>
              <TH>Method</TH>
              <TH>Status</TH>
              <TH align="right">Amount</TH>
              <TH align="right">Receipt</TH>
            </THead>
            <TBody>
              {items.length === 0 && <TableEmpty colSpan={6} title="No payments" />}
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
                  <TD>{formatDate(payment.paidAt ?? payment.createdAt)}</TD>
                  <TD>
                    {payment.paymentMethodLast4
                      ? `${payment.paymentMethodBrand} ···· ${payment.paymentMethodLast4}`
                      : "—"}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(payment.status)} size="sm">
                      {PAYMENT_STATUS_LABELS[payment.status]}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <span className="font-semibold text-ink-900">
                      {formatMoney(payment.totalCents)}
                    </span>
                    {payment.refundedCents > 0 && (
                      <span className="block text-xs text-success-700">
                        −{formatMoney(payment.refundedCents)} refunded
                      </span>
                    )}
                  </TD>
                  <TD align="right">
                    {payment.status !== PAYMENT_STATUS.REQUIRES_PAYMENT && (
                      <Link
                        href={`/payments/${payment.id}`}
                        className="text-sm font-semibold text-brand-600 hover:underline"
                      >
                        View
                      </Link>
                    )}
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
          buildHref={(p) => `/payments?page=${p}`}
        />
      </div>
    </DashboardPage>
  );
}
