import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, DISPUTE_STATUS_LABELS, DISPUTE_REASON_LABELS, BOOKING_STATUS_LABELS,
} from "@/constants";
import { getDispute } from "@/services/dispute.service";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { DisputeResolution } from "@/components/admin/DisputeResolution";
import { formatMoney, formatDateTime, formatRelative, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Dispute", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDisputeDetailPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(ROLES.ADMIN, `/admin/disputes/${id}`);
  await connectToDatabase();

  const dispute = await getDispute(id, user).catch(() => null);
  if (!dispute) notFound();

  const booking = dispute.bookingId;

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/admin/disputes"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All disputes
          </Link>
        }
        title={`Dispute ${dispute.reference}`}
        description={`Raised ${formatRelative(dispute.createdAt)} · ${DISPUTE_REASON_LABELS[dispute.reason]}`}
        action={<Badge tone="warning">{DISPUTE_STATUS_LABELS[dispute.status]}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="What was reported"
              description={`By ${dispute.raisedBy?.firstName} ${dispute.raisedBy?.lastName} (${dispute.raisedByRole?.toLowerCase()})`}
            />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-600">
                {dispute.description}
              </p>
              {dispute.requestedRefundCents > 0 && (
                <p className="mt-4 rounded-lg bg-ink-50 p-3 text-sm">
                  <span className="text-ink-500">Refund requested: </span>
                  <span className="font-bold text-ink-900">
                    {formatMoney(dispute.requestedRefundCents)}
                  </span>
                </p>
              )}
            </CardBody>
          </Card>

          <DisputeResolution dispute={dispute} booking={booking} />

          {dispute.adminNotes?.length > 0 && (
            <Card>
              <CardHeader title="Internal notes" description="Only visible to administrators." />
              <CardBody>
                <ul className="space-y-3">
                  {dispute.adminNotes.map((note) => (
                    <li key={note._id ?? note.createdAt} className="rounded-xl bg-ink-50 p-3">
                      <p className="text-xs text-ink-400">{formatDate(note.createdAt)}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-600">{note.note}</p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="The lesson" />
            <CardBody>
              <dl className="space-y-3 text-sm">
                <Row label="Reference" value={booking?.reference} />
                <Row
                  label="Course"
                  value={booking?.courseCode ? `${booking.courseCode} — ${booking.courseName}` : booking?.courseName}
                />
                <Row
                  label="When"
                  value={booking?.startAt ? formatDateTime(booking.startAt, booking.timeZone) : "—"}
                />
                <Row
                  label="Lesson status"
                  value={BOOKING_STATUS_LABELS[booking?.status] ?? "—"}
                />
                <Row
                  label="Total paid"
                  value={booking?.price ? formatMoney(booking.price.totalCents) : "—"}
                />
                {booking?.cancellation?.refundCents > 0 && (
                  <Row
                    label="Already refunded"
                    value={formatMoney(booking.cancellation.refundCents)}
                  />
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Parties" />
            <CardBody>
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Raised by
                  </dt>
                  <dd className="mt-0.5">
                    <Link
                      href={`/admin/users/${dispute.raisedBy?.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {dispute.raisedBy?.firstName} {dispute.raisedBy?.lastName}
                    </Link>
                    <span className="block text-xs text-ink-500">{dispute.raisedBy?.email}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                    Against
                  </dt>
                  <dd className="mt-0.5">
                    <Link
                      href={`/admin/users/${dispute.againstUserId?.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {dispute.againstUserId?.firstName} {dispute.againstUserId?.lastName}
                    </Link>
                    <span className="block text-xs text-ink-500">
                      {dispute.againstUserId?.email}
                    </span>
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardPage>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink-800">{value}</dd>
    </div>
  );
}
