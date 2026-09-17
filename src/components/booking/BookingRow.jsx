import Link from "next/link";
import { CalendarDays, Video, MapPin, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar, Badge } from "@/components/ui";
import { formatDate, formatTime, formatMoney, formatDuration } from "@/lib/utils/format";
import {
  BOOKING_STATUS, BOOKING_STATUS_LABELS, LESSON_MODES, CANCELLED_STATUSES, ROLES,
} from "@/constants";

/** Status → badge tone, so the same lesson reads the same everywhere. */
export function statusTone(status) {
  if (status === BOOKING_STATUS.CONFIRMED) return "success";
  if (status === BOOKING_STATUS.COMPLETED) return "brand";
  if (status === BOOKING_STATUS.PENDING_PAYMENT) return "warning";
  if (status === BOOKING_STATUS.DISPUTED) return "danger";
  if (CANCELLED_STATUSES.includes(status)) return "neutral";
  if (status === BOOKING_STATUS.EXPIRED) return "neutral";
  if (status?.startsWith("NO_SHOW")) return "danger";
  return "neutral";
}

/**
 * One lesson in a list. Shows the *other* party — a parent sees the tutor, a
 * tutor sees the student (with the minor-privacy name rule applied).
 */
export function BookingRow({ booking, viewerRole, href }) {
  const isTutorView = viewerRole === ROLES.TUTOR;

  const tutorUser = booking.tutorProfileId?.userId;
  const student = booking.studentProfileId;

  const counterparty = isTutorView
    ? {
        name: student
          ? student.isMinor && !student.shareFullNameWithTutor
            ? `${student.firstName} ${student.lastName?.charAt(0) ?? ""}.`.trim()
            : `${student.firstName} ${student.lastName ?? ""}`.trim()
          : "Student",
        avatarUrl: student?.avatarUrl,
        firstName: student?.firstName,
        lastName: student?.lastName,
      }
    : {
        name: tutorUser
          ? `${tutorUser.firstName} ${tutorUser.lastName?.charAt(0) ?? ""}.`
          : "Tutor",
        avatarUrl: tutorUser?.avatarUrl,
        firstName: tutorUser?.firstName,
        lastName: tutorUser?.lastName,
      };

  const target = href ?? (isTutorView ? `/tutor/bookings/${booking.id}` : `/bookings/${booking.id}`);
  const isOnline = booking.mode === LESSON_MODES.ONLINE;
  const isPast = new Date(booking.startAt) < new Date();

  return (
    <Link
      href={target}
      className="flex items-center gap-4 p-4 transition-colors hover:bg-ink-50 sm:p-5"
    >
      {/* Date block reads at a glance in a long list */}
      <div
        className={cn(
          "flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border",
          isPast ? "border-ink-200 bg-ink-50" : "border-brand-200 bg-brand-50",
        )}
      >
        <span className="text-[10px] font-bold uppercase text-ink-400">
          {formatDate(booking.startAt, { month: "short", timeZone: booking.timeZone }).split(" ")[0]}
        </span>
        <span className={cn("text-base font-extrabold tabular-nums", isPast ? "text-ink-600" : "text-brand-700")}>
          {new Date(booking.startAt).getDate()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-bold text-ink-900">
            {booking.courseCode ? `${booking.courseCode} — ` : ""}
            {booking.courseName}
          </p>
          <Badge tone={statusTone(booking.status)} size="sm">
            {BOOKING_STATUS_LABELS[booking.status]}
          </Badge>
        </div>

        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-500">
          <span className="flex items-center gap-1">
            <CalendarDays className="size-3" />
            {formatTime(booking.startAt, booking.timeZone)} ·{" "}
            {formatDuration(booking.durationMinutes)}
          </span>
          <span className="flex items-center gap-1">
            {isOnline ? <Video className="size-3" /> : <MapPin className="size-3" />}
            {isOnline ? "Online" : "In person"}
          </span>
        </p>

        <div className="mt-2 flex items-center gap-2">
          <Avatar
            src={counterparty.avatarUrl}
            firstName={counterparty.firstName}
            lastName={counterparty.lastName}
            name={counterparty.name}
            size="xs"
          />
          <span className="truncate text-xs text-ink-600">
            {isTutorView ? counterparty.name : `with ${counterparty.name}`}
          </span>
        </div>
      </div>

      <div className="hidden shrink-0 text-right sm:block">
        <p className="text-sm font-bold text-ink-900">
          {formatMoney(isTutorView ? booking.price.tutorEarningsCents : booking.price.totalCents)}
        </p>
        <p className="text-[11px] text-ink-400">{isTutorView ? "you earn" : "total"}</p>
      </div>

      <ChevronRight className="size-4 shrink-0 text-ink-300" aria-hidden="true" />
    </Link>
  );
}
