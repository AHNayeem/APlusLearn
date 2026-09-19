import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  LEARNER_ROLES, PACKAGE_PURCHASE_STATUS, PACKAGE_PURCHASE_STATUS_LABELS,
  BOOKING_STATUS_LABELS,
} from "@/constants";
import { getPurchase } from "@/services/package.service";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Progress,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { CancelPackageButton } from "@/components/packages/CancelPackageButton";
import { formatMoney, formatDate, formatTime, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "Package", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PackageDetailPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/packages/${id}`);
  await connectToDatabase();

  const result = await getPurchase(id, user).catch(() => null);
  if (!result) notFound();

  const { purchase, bookings, canCancel } = result;
  const remaining = purchase.sessionsTotal - purchase.sessionsUsed;
  const tutor = purchase.tutorProfileId;
  const active = purchase.status === PACKAGE_PURCHASE_STATUS.ACTIVE;

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/packages"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            My packages
          </Link>
        }
        title={purchase.title}
        description={`${purchase.reference} · ${PACKAGE_PURCHASE_STATUS_LABELS[purchase.status]}`}
        action={
          canCancel && active && remaining > 0 ? (
            <CancelPackageButton purchase={purchase} remaining={remaining} />
          ) : null
        }
      />

      <div className="grid max-w-4xl gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Lessons" />
            <CardBody className="space-y-4">
              <Progress
                value={purchase.sessionsUsed}
                max={purchase.sessionsTotal}
                label={`${remaining} of ${purchase.sessionsTotal} left`}
                showValue
              />

              {active && remaining > 0 && tutor?.slug && (
                <Button
                  href={`/tutors/${tutor.slug}#availability`}
                  iconLeft={<CalendarDays className="size-4" />}
                >
                  Book a lesson from this package
                </Button>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Lessons booked from it" />
            <CardBody className="p-0">
              {bookings.length === 0 ? (
                <EmptyState
                  title="Nothing booked yet"
                  description="Pick a time that suits and the lesson comes straight out of this package."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {bookings.map((booking) => (
                    <li key={booking.id} className="px-5 py-3">
                      <Link
                        href={`/bookings/${booking.id}`}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-800">
                            {formatDate(booking.startAt, { weekday: "short" })} at{" "}
                            {formatTime(booking.startAt)}
                          </p>
                          <p className="text-xs text-ink-500">
                            {booking.courseCode ?? booking.courseName} · {booking.reference}
                          </p>
                        </div>
                        <Badge tone="neutral" size="sm">
                          {BOOKING_STATUS_LABELS[booking.status]}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row label="Tutor" value={tutor?.userId ? `${tutor.userId.firstName} ${tutor.userId.lastName?.charAt(0) ?? ""}.` : "—"} />
              <Row label="Course" value={purchase.courseCode ?? purchase.courseName} />
              <Row label="For" value={purchase.studentProfileId?.firstName} />
              <Row label="Lesson length" value={formatDuration(purchase.sessionDurationMinutes)} />
              <Row label="Paid" value={formatMoney(purchase.priceCents)} />
              <Row label="Per lesson" value={formatMoney(purchase.perSessionCents)} />
              {purchase.expiresAt && (
                <Row label="Valid until" value={formatDate(purchase.expiresAt)} />
              )}
              {purchase.refundedCents > 0 && (
                <Row label="Refunded" value={formatMoney(purchase.refundedCents)} />
              )}
            </dl>

            {active && (
              <Alert tone="neutral" title="If you cancel a lesson" className="mt-4">
                A lesson cancelled with enough notice goes straight back into this package. A late
                cancellation uses it up, exactly as it would if you had paid for that lesson on
                its own.
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>
    </DashboardPage>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-800">{value}</dd>
    </div>
  );
}
