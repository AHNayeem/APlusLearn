import Link from "next/link";
import {
  CalendarDays, TrendingUp, Users, Star, MessageSquare, Video, MapPin,
  ArrowRight, Megaphone, Banknote, Eye,
} from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, LESSON_MODES } from "@/constants";
import { getTutorProfileByUserId, getOrCreateApplication } from "@/services/tutor.service";
import { bookingSummary, listBookings } from "@/services/booking.service";
import { tutorEarnings } from "@/services/payment.service";
import { listConversations } from "@/services/message.service";
import { listReviews } from "@/services/review.service";
import { listOpenRequestsForTutor } from "@/services/request.service";
import {
  Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, EmptyState, Rating, StatCard,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { BookingRow } from "@/components/booking/BookingRow";
import { ApplicationStatusBanner } from "@/components/tutor/ApplicationStatusBanner";
import { JoinLessonButton } from "@/components/booking/JoinLessonButton";
import { formatMoney, formatDateTime, formatNumber, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Tutor dashboard" };
export const dynamic = "force-dynamic";

export default async function TutorDashboardPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/dashboard");
  await connectToDatabase();

  const [profile, application] = await Promise.all([
    getTutorProfileByUserId(user.id),
    getOrCreateApplication(user.id),
  ]);

  // Before a profile exists there is nothing to summarise — show the banner
  // and the next action instead of a wall of zeros.
  if (!profile) {
    return (
      <DashboardPage>
        <PageHeader title={`Welcome, ${user.firstName}`} />
        <ApplicationStatusBanner application={application} profile={profile} />
        <EmptyState
          icon={<Star className="size-7" />}
          title="Your tutor profile isn't set up yet"
          description="Complete the application and our team will review it within two business days."
          action={<Button href="/tutor/onboarding">Start my application</Button>}
        />
      </DashboardPage>
    );
  }

  const [summary, upcoming, earnings, conversations, reviews, requests] = await Promise.all([
    bookingSummary(user),
    listBookings(user, { scope: "UPCOMING", page: 1, pageSize: 4 }),
    tutorEarnings(user.id, { days: 30 }),
    listConversations(user, { pageSize: 4 }),
    listReviews(user, { pageSize: 3 }),
    listOpenRequestsForTutor(user, { pageSize: 3 }),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title={`Welcome back, ${user.firstName}`}
        description={
          summary.nextLesson
            ? `Your next lesson is ${formatDateTime(summary.nextLesson.startAt, summary.nextLesson.timeZone)}.`
            : "No lessons booked yet."
        }
        action={
          <>
            <Button href="/tutor/calendar" iconLeft={<CalendarDays className="size-4" />}>
              My calendar
            </Button>
            {profile.isSearchable && (
              <Button
                href={`/tutors/${profile.slug}`}
                variant="secondary"
                iconLeft={<Eye className="size-4" />}
              >
                View public profile
              </Button>
            )}
          </>
        }
      />

      <ApplicationStatusBanner application={application} profile={profile} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Upcoming lessons"
          value={formatNumber(summary.upcoming)}
          icon={<CalendarDays className="size-5" />}
          href="/tutor/bookings"
        />
        <StatCard
          label="Earned (30 days)"
          value={formatMoney(earnings.period.netCents, { compact: true })}
          hint={`${earnings.period.lessons} lessons`}
          icon={<TrendingUp className="size-5" />}
          href="/tutor/earnings"
        />
        <StatCard
          label="Students taught"
          value={formatNumber(profile.stats?.totalStudents ?? 0)}
          icon={<Users className="size-5" />}
          href="/tutor/students"
        />
        <StatCard
          label="Rating"
          value={
            profile.stats?.ratingCount
              ? profile.stats.ratingAverage.toFixed(1)
              : "—"
          }
          hint={
            profile.stats?.ratingCount
              ? `${profile.stats.ratingCount} reviews`
              : "No reviews yet"
          }
          icon={<Star className="size-5" />}
          href="/tutor/reviews"
        />
      </div>

      {earnings.pendingPayoutCents > 0 && (
        <Alert
          tone="success"
          title={`${formatMoney(earnings.pendingPayoutCents)} ready for payout`}
          className="mt-6"
          action={
            <Button href="/tutor/payouts" size="sm" variant="secondary">
              View payouts
            </Button>
          }
        >
          Earnings become payable a few days after each lesson is completed.
        </Alert>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          {summary.nextLesson && <NextLessonCard booking={summary.nextLesson} />}

          <Card>
            <CardHeader
              title="Upcoming lessons"
              action={
                upcoming.items.length > 0 && (
                  <Button
                    href="/tutor/bookings"
                    variant="ghost"
                    size="sm"
                    iconRight={<ArrowRight className="size-3.5" />}
                  >
                    View all
                  </Button>
                )
              }
            />
            <CardBody className="p-0">
              {upcoming.items.length === 0 ? (
                <EmptyState
                  compact
                  className="m-5 border-0 bg-transparent"
                  icon={<CalendarDays className="size-6" />}
                  title="No lessons booked"
                  description={
                    profile.isSearchable
                      ? "Keep your availability current — families book the tutors whose calendars are open."
                      : "Your profile isn't live yet, so families can't book you."
                  }
                  action={
                    <Button href="/tutor/calendar" size="sm">
                      Update availability
                    </Button>
                  }
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {upcoming.items.map((booking) => (
                    <li key={booking.id}>
                      <BookingRow booking={booking} viewerRole={ROLES.TUTOR} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent reviews"
              action={
                reviews.items.length > 0 && (
                  <Button
                    href="/tutor/reviews"
                    variant="ghost"
                    size="sm"
                    iconRight={<ArrowRight className="size-3.5" />}
                  >
                    All reviews
                  </Button>
                )
              }
            />
            <CardBody>
              {reviews.items.length === 0 ? (
                <EmptyState
                  compact
                  className="border-0 bg-transparent"
                  icon={<Star className="size-6" />}
                  title="No reviews yet"
                  description="Families can review you once a lesson is completed."
                />
              ) : (
                <ul className="space-y-4">
                  {reviews.items.map((review) => (
                    <li key={review.id} className="border-b border-ink-100 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <Rating value={review.rating} showValue={false} size="sm" />
                        <span className="text-xs text-ink-400">
                          {formatRelative(review.createdAt)}
                        </span>
                        {!review.tutorReply && (
                          <Badge tone="warning" size="sm" className="ml-auto">
                            Reply pending
                          </Badge>
                        )}
                      </div>
                      {review.title && (
                        <p className="mt-2 text-sm font-bold text-ink-900">{review.title}</p>
                      )}
                      <p className="mt-1 line-clamp-2 text-sm text-ink-600">{review.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Messages"
              action={
                <Button
                  href="/tutor/messages"
                  variant="ghost"
                  size="sm"
                  iconRight={<ArrowRight className="size-3.5" />}
                >
                  All
                </Button>
              }
            />
            <CardBody className="p-0">
              {conversations.items.length === 0 ? (
                <EmptyState
                  compact
                  className="m-4 border-0 bg-transparent"
                  icon={<MessageSquare className="size-5" />}
                  title="No messages"
                  description="Families often message before booking — quick replies win bookings."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {conversations.items.map((conversation) => (
                    <li key={conversation.id}>
                      <Link
                        href={`/tutor/messages/${conversation.id}`}
                        className="flex items-center gap-3 p-4 transition-colors hover:bg-ink-50"
                      >
                        <Avatar
                          src={conversation.otherParty?.avatarUrl}
                          name={conversation.otherParty?.name}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink-900">
                              {conversation.otherParty?.name}
                            </span>
                            {conversation.unreadCount > 0 && (
                              <Badge tone="brand" size="sm">
                                {conversation.unreadCount}
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-500">
                            {conversation.lastMessagePreview}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {requests.items.length > 0 && (
            <Card>
              <CardHeader
                title="Tutor requests"
                description="Families looking for someone who teaches your courses."
                action={
                  <Button
                    href="/tutor/requests"
                    variant="ghost"
                    size="sm"
                    iconRight={<ArrowRight className="size-3.5" />}
                  >
                    All
                  </Button>
                }
              />
              <CardBody className="space-y-3">
                {requests.items.map((request) => (
                  <Link
                    key={request.id}
                    href={`/tutor/requests/${request.id}`}
                    className="block rounded-xl border border-ink-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {request.courseCode ?? request.courseName}
                      </p>
                      {request.matchScore && (
                        <Badge tone="success" size="sm">
                          {request.matchScore}% match
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-500">{request.goal}</p>
                    {request.hasResponded && (
                      <Badge tone="neutral" size="sm" className="mt-2">
                        You responded
                      </Badge>
                    )}
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Profile health" />
            <CardBody className="space-y-3 text-sm">
              <HealthRow
                label="Visible in search"
                ok={profile.isSearchable}
                hint={profile.isSearchable ? "Live" : "Not yet approved"}
              />
              <HealthRow
                label="Accepting new students"
                ok={profile.acceptingNewStudents}
                hint={profile.acceptingNewStudents ? "Yes" : "Paused"}
              />
              <HealthRow
                label="Verification badges"
                ok={profile.verifiedTypes?.length > 0}
                hint={`${profile.verifiedTypes?.length ?? 0} earned`}
              />
              <HealthRow
                label="Courses listed"
                ok={profile.courses?.length > 0}
                hint={`${profile.courses?.length ?? 0} courses`}
              />
              <Button href="/tutor/profile" variant="secondary" size="sm" fullWidth className="mt-2">
                Edit profile
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardPage>
  );
}

function HealthRow({ label, ok, hint }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={ok ? "size-2 rounded-full bg-success-500" : "size-2 rounded-full bg-warning-500"}
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-ink-700">{hint}</span>
      </span>
    </div>
  );
}

function NextLessonCard({ booking }) {
  const student = booking.studentProfileId;
  const studentName = student
    ? student.isMinor && !student.shareFullNameWithTutor
      ? `${student.firstName} ${student.lastName?.charAt(0) ?? ""}.`.trim()
      : `${student.firstName} ${student.lastName ?? ""}`.trim()
    : "Your student";

  const isOnline = booking.mode === LESSON_MODES.ONLINE;

  return (
    <Card className="overflow-hidden border-brand-200">
      <div className="bg-brand-600 px-5 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-100">Next lesson</p>
      </div>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-4">
            <Avatar
              src={student?.avatarUrl}
              firstName={student?.firstName}
              lastName={student?.lastName}
              size="lg"
            />
            <div className="min-w-0">
              <p className="text-base font-bold text-ink-900">
                {booking.courseCode ? `${booking.courseCode} — ` : ""}
                {booking.courseName}
              </p>
              <p className="mt-0.5 text-sm text-ink-600">with {studentName}</p>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="size-4 text-ink-400" />
                  {formatDateTime(booking.startAt, booking.timeZone)}
                </span>
                <span className="flex items-center gap-1.5">
                  {isOnline ? (
                    <Video className="size-4 text-ink-400" />
                  ) : (
                    <MapPin className="size-4 text-ink-400" />
                  )}
                  {isOnline ? "Online" : (booking.location?.label ?? "In person")}
                </span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            {isOnline && (
              <JoinLessonButton
                startAt={booking.startAt}
                joinUrl={booking.meeting?.joinUrl}
                label="Start lesson"
              />
            )}
            <Button href={`/tutor/bookings/${booking.id}`} variant="secondary">
              Lesson details
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
