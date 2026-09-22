import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, PAYMENT_STATUS_LABELS, LESSON_MODE_LABELS } from "@/constants";
import { getReceipt } from "@/services/payment.service";
import { getAppConfig } from "@/services/settings.service";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatDateTime, formatDuration } from "@/lib/utils/format";
import { PrintButton } from "@/components/dashboard/PrintButton";

export const metadata = { title: "Receipt", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/payments/${id}`);
  await connectToDatabase();

  const [receipt, { branding, contact }] = await Promise.all([
    getReceipt(id, user).catch(() => null),
    getAppConfig(),
  ]);
  if (!receipt) notFound();

  const { payment, bookings, receiptNumber, issuedAt } = receipt;

  return (
    <DashboardPage>
      {/* Screen chrome only — the printed sheet carries its own heading, so the
          whole block (breadcrumb, title and the Print action) is dropped. */}
      <PageHeader
        className="no-print"
        breadcrumb={
          <Link
            href="/payments"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All payments
          </Link>
        }
        title="Receipt"
        action={<PrintButton />}
      />

      {/* `print-document` scopes @media print in globals.css to this card. */}
      <Card className="print-document mx-auto max-w-2xl">
        <CardHeader
          title={branding.appName}
          description={`Receipt ${receiptNumber}`}
          action={<Badge tone="success">{PAYMENT_STATUS_LABELS[payment.status]}</Badge>}
        />
        <CardBody className="space-y-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Issued
              </dt>
              <dd className="mt-0.5 font-medium text-ink-800">{formatDate(issuedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Payment method
              </dt>
              <dd className="mt-0.5 font-medium text-ink-800">
                {payment.paymentMethodLast4
                  ? `${payment.paymentMethodBrand} ending ${payment.paymentMethodLast4}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Billed to
              </dt>
              <dd className="mt-0.5 font-medium text-ink-800">
                {user.firstName} {user.lastName}
                <span className="block text-xs font-normal text-ink-500">{user.email}</span>
              </dd>
            </div>
          </dl>

          <div className="border-t border-ink-100 pt-5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
              {bookings.length > 1 ? `${bookings.length} lessons` : "Lesson"}
            </h3>
            <ul className="mt-3 space-y-3">
              {bookings.map((booking) => (
                <li key={booking.id} className="flex justify-between gap-4 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">
                      {booking.courseCode ? `${booking.courseCode} — ` : ""}
                      {booking.courseName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatDateTime(booking.startAt, booking.timeZone)} ·{" "}
                      {formatDuration(booking.durationMinutes)} ·{" "}
                      {LESSON_MODE_LABELS[booking.mode]}
                    </p>
                    <p className="text-xs text-ink-400">Ref {booking.reference}</p>
                  </div>
                  <p className="shrink-0 font-semibold text-ink-900">
                    {formatMoney(booking.price.totalCents)}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <dl className="space-y-2 border-t border-ink-100 pt-5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-500">Subtotal</dt>
              <dd className="font-semibold text-ink-900">{formatMoney(payment.subtotalCents)}</dd>
            </div>
            {payment.refundedCents > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-500">Refunded</dt>
                <dd className="font-semibold text-success-700">
                  −{formatMoney(payment.refundedCents)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t border-ink-100 pt-2">
              <dt className="text-base font-bold text-ink-900">
                {payment.refundedCents > 0 ? "Net paid" : "Total paid"}
              </dt>
              <dd className="text-base font-extrabold text-ink-900">
                {formatMoney(payment.totalCents - (payment.refundedCents ?? 0))}
              </dd>
            </div>
          </dl>

          {payment.refunds?.length > 0 && (
            <div className="border-t border-ink-100 pt-5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Refunds</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {payment.refunds.map((refund) => (
                  <li key={refund.id ?? refund.issuedAt} className="flex justify-between gap-4">
                    <span className="min-w-0 text-ink-600">
                      {refund.reason}
                      <span className="block text-xs text-ink-400">
                        {formatDate(refund.issuedAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold text-success-700">
                      {formatMoney(refund.amountCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-ink-100 pt-5 text-xs leading-relaxed text-ink-400">
            {branding.appName} operates as a marketplace. Tutors are independent contractors.
            Questions about this receipt? Contact {contact.supportEmail}.
          </p>
        </CardBody>
      </Card>
    </DashboardPage>
  );
}
