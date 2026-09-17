import Link from "next/link";
import {
  CalendarDays, Clock, Video, MapPin, User, Receipt, MessageSquare, Copy, Info,
} from "lucide-react";
import {
  Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, Rating,
} from "@/components/ui";
import {
  formatDate, formatTime, formatDuration, formatMoney, formatDateTime,
} from "@/lib/utils/format";
import {
  BOOKING_STATUS, BOOKING_STATUS_LABELS, LESSON_MODES, MEETING_PROVIDER_LABELS,
  CANCELLED_STATUSES, ROLES,
} from "@/constants";
import { statusTone } from "./BookingRow";
import { BookingActions } from "./BookingActions";
import { JoinLessonButton } from "./JoinLessonButton";

/**
 * Full lesson view (§19, §27).
 *
 * The meeting link and any in-person address only appear when the booking is
 * confirmed — before that there is nothing to attend, and the address is not
 * released (§42).
 */
export function BookingDetail({ booking, viewerRole, justConfirmed }) {
  const isTutorView = viewerRole === ROLES.TUTOR;
  const isOnline = booking.mode === LESSON_MODES.ONLINE;
  const tutorProfile = booking.tutorProfileId;
  const tutorUser = tutorProfile?.userId;
  const student = booking.studentProfileId;
  const payment = booking.paymentId;

  const isCancelled = CANCELLED_STATUSES.includes(booking.status);
  const isConfirmed = booking.status === BOOKING_STATUS.CONFIRMED;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        {justConfirmed && (
          <Alert tone="success" title="Your lesson is confirmed">
            We&rsquo;ve emailed the details. {isOnline ? "The meeting link is below." : "The location is below."}
          </Alert>
        )}

        {booking.status === BOOKING_STATUS.PENDING_PAYMENT && (
          <Alert
            tone="warning"
            title="Payment not completed"
            action={
              <Button href={`/bookings/checkout/${payment?.id ?? payment}`} size="sm">
                Complete payment
              </Button>
            }
          >
            This lesson is held but not confirmed until payment goes through.
          </Alert>
        )}

        {booking.status === BOOKING_STATUS.EXPIRED && (
          <Alert
            tone="neutral"
            title="This time has been released"
            action={
              tutorProfile?.slug ? (
                <Button href={`/tutors/${tutorProfile.slug}`} size="sm" variant="secondary">
                  Book again
                </Button>
              ) : null
            }
          >
            Payment was not completed in time, so the slot went back on the tutor&rsquo;s
            calendar and is available to other learners. Nothing was charged.
          </Alert>
        )}

        {isCancelled && booking.cancellation && (
          <Alert tone="neutral" title={`Cancelled — ${booking.cancellation.policyApplied?.replace(/_/g, " ").toLowerCase()}`}>
            <p>{booking.cancellation.reason}</p>
            <p className="mt-2">
              {booking.cancellation.refundCents > 0
                ? `${formatMoney(booking.cancellation.refundCents)} was refunded (${booking.cancellation.refundPercent}% of the total).`
                : "No refund applied under the cancellation policy."}
            </p>
          </Alert>
        )}

        <Card>
          <CardHeader
            title={`${booking.courseCode ? `${booking.courseCode} — ` : ""}${booking.courseName}`}
            description={`Reference ${booking.reference}`}
            action={
              <Badge tone={statusTone(booking.status)}>
                {BOOKING_STATUS_LABELS[booking.status]}
              </Badge>
            }
          />
          <CardBody className="space-y-6">
            <dl className="grid gap-5 sm:grid-cols-2">
              <Detail
                icon={<CalendarDays className="size-4" />}
                label="Date"
                value={formatDate(booking.startAt, { weekday: "long", timeZone: booking.timeZone })}
              />
              <Detail
                icon={<Clock className="size-4" />}
                label="Time"
                value={`${formatTime(booking.startAt, booking.timeZone)} – ${formatTime(booking.endAt, booking.timeZone)} (${formatDuration(booking.durationMinutes)})`}
              />
              <Detail
                icon={isOnline ? <Video className="size-4" /> : <MapPin className="size-4" />}
                label="Lesson type"
                value={
                  isOnline
                    ? `Online${booking.meeting?.provider ? ` · ${MEETING_PROVIDER_LABELS[booking.meeting.provider]}` : ""}`
                    : `In person${booking.location?.label ? ` · ${booking.location.label}` : ""}`
                }
              />
              <Detail
                icon={<User className="size-4" />}
                label={isTutorView ? "Student" : "Tutor"}
                value={
                  isTutorView
                    ? student
                      ? student.isMinor && !student.shareFullNameWithTutor
                        ? `${student.firstName} ${student.lastName?.charAt(0) ?? ""}.`.trim()
                        : `${student.firstName} ${student.lastName ?? ""}`.trim()
                      : "—"
                    : tutorUser
                      ? `${tutorUser.firstName} ${tutorUser.lastName?.charAt(0) ?? ""}.`
                      : "—"
                }
              />
            </dl>

            {/* Joining details — only once there is a confirmed lesson (§27) */}
            {isConfirmed && isOnline && booking.meeting?.joinUrl && (
              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4">
                <p className="text-sm font-bold text-brand-900">Joining the lesson</p>
                <p className="mt-1 text-xs text-brand-700/80">
                  The link opens at the scheduled time. No download needed for most platforms.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <JoinLessonButton
                    startAt={booking.startAt}
                    joinUrl={booking.meeting.joinUrl}
                    label={`Join ${MEETING_PROVIDER_LABELS[booking.meeting.provider]}`}
                  />
                  {booking.meeting.passcode && (
                    <Badge tone="neutral">Passcode {booking.meeting.passcode}</Badge>
                  )}
                </div>
              </div>
            )}

            {isConfirmed && !isOnline && booking.location && (
              <div className="rounded-xl border border-accent-200 bg-accent-50/60 p-4">
                <p className="text-sm font-bold text-accent-900">Where to meet</p>
                <p className="mt-1 text-sm text-ink-700">{booking.location.label}</p>
                {booking.location.addressLine && (
                  <p className="mt-0.5 text-sm text-ink-600">{booking.location.addressLine}</p>
                )}
                {booking.location.city && (
                  <p className="text-sm text-ink-600">{booking.location.city}</p>
                )}
                {booking.location.notes && (
                  <p className="mt-2 text-xs text-ink-500">{booking.location.notes}</p>
                )}
              </div>
            )}

            {booking.studentNotes && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                  Notes from the family
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{booking.studentNotes}</p>
              </div>
            )}

            {isTutorView && booking.tutorNotes && (
              <div className="rounded-xl bg-ink-50 p-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                  Your private notes
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{booking.tutorNotes}</p>
              </div>
            )}
          </CardBody>

          <div className="border-t border-ink-100 p-5">
            <BookingActions
              booking={booking}
              viewerRole={viewerRole}
              cancellationPolicy={booking.cancellationPolicy}
            />
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        {!isTutorView && tutorProfile && tutorUser && (
          <Card>
            <CardHeader title="Your tutor" />
            <CardBody>
              <div className="flex gap-3">
                <Avatar
                  src={tutorUser.avatarUrl}
                  firstName={tutorUser.firstName}
                  lastName={tutorUser.lastName}
                  size="lg"
                />
                <div className="min-w-0">
                  <Link
                    href={`/tutors/${tutorProfile.slug}`}
                    className="text-sm font-bold text-ink-900 hover:text-brand-700"
                  >
                    {tutorUser.firstName} {tutorUser.lastName?.charAt(0)}.
                  </Link>
                  <Rating
                    value={tutorProfile.stats?.ratingAverage ?? 0}
                    count={tutorProfile.stats?.ratingCount}
                    size="sm"
                    className="mt-1"
                  />
                  <p className="mt-1 text-xs text-ink-500">
                    {tutorProfile.city}, {tutorProfile.province}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2">
                <Button
                  href={`/messages?tutor=${tutorProfile.id}`}
                  variant="secondary"
                  size="sm"
                  fullWidth
                  iconLeft={<MessageSquare className="size-3.5" />}
                >
                  Message
                </Button>
                <Button
                  href={`/tutors/${tutorProfile.slug}#availability`}
                  size="sm"
                  fullWidth
                >
                  Book again
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title={isTutorView ? "Your earnings" : "Payment"} />
          <CardBody>
            <dl className="space-y-2.5 text-sm">
              <Row label="Hourly rate" value={formatMoney(booking.price.hourlyRateCents)} />
              <Row label="Length" value={formatDuration(booking.price.durationMinutes)} />
              <Row label="Lesson total" value={formatMoney(booking.price.subtotalCents)} />

              {isTutorView && (
                <>
                  <Row
                    label={`Platform fee (${booking.price.commissionPercent}%)`}
                    value={`− ${formatMoney(booking.price.commissionCents)}`}
                    muted
                  />
                  <div className="flex justify-between gap-3 border-t border-ink-100 pt-2.5">
                    <dt className="font-bold text-ink-900">You earn</dt>
                    <dd className="font-extrabold text-ink-900">
                      {formatMoney(booking.price.tutorEarningsCents)}
                    </dd>
                  </div>
                </>
              )}

              {!isTutorView && (
                <div className="flex justify-between gap-3 border-t border-ink-100 pt-2.5">
                  <dt className="font-bold text-ink-900">Total paid</dt>
                  <dd className="font-extrabold text-ink-900">
                    {formatMoney(booking.price.totalCents)}
                  </dd>
                </div>
              )}

              {booking.cancellation?.refundCents > 0 && (
                <Row
                  label="Refunded"
                  value={formatMoney(booking.cancellation.refundCents)}
                  tone="success"
                />
              )}
            </dl>

            {!isTutorView && payment?.id && payment.status !== "REQUIRES_PAYMENT" && (
              <Button
                href={`/payments/${payment.id}`}
                variant="secondary"
                size="sm"
                fullWidth
                className="mt-4"
                iconLeft={<Receipt className="size-3.5" />}
              >
                View receipt
              </Button>
            )}
          </CardBody>
        </Card>

        {booking.cancellationPolicy && !isCancelled && (
          <Card>
            <CardHeader title="Cancellation policy" />
            <CardBody>
              <ul className="space-y-2 text-xs leading-relaxed text-ink-500">
                {booking.cancellationPolicy.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Info className="mt-0.5 size-3 shrink-0" />
                    {line}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function Detail({ icon, label, value }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-ink-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
        <dd className="mt-0.5 text-sm font-medium text-ink-800">{value}</dd>
      </div>
    </div>
  );
}

function Row({ label, value, muted, tone }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={
          tone === "success"
            ? "font-semibold text-success-700"
            : muted
              ? "text-ink-500"
              : "font-semibold text-ink-900"
        }
      >
        {value}
      </dd>
    </div>
  );
}
