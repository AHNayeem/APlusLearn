import Link from "next/link";
import {
  CalendarDays, MessageSquare, Heart, Star, Users, CreditCard, Search,
  Video, MapPin, ArrowRight, Megaphone,
} from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, ROLES, BOOKING_STATUS, LESSON_MODES } from "@/constants";
import { bookingSummary, listBookings } from "@/services/booking.service";
import { listStudents, listFavourites } from "@/services/student.service";
import { listMyTutors } from "@/services/tutor.service";
import { listConversations } from "@/services/message.service";
import { listRequests } from "@/services/request.service";
import { unreadNotificationCount } from "@/services/notification.service";
import {
  Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, EmptyState, StatCard,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { BookingRow } from "@/components/booking/BookingRow";
import { JoinLessonButton } from "@/components/booking/JoinLessonButton";
import { TutorCardCompact } from "@/components/tutor/TutorCard";
import { formatDateTime, formatNumber } from "@/lib/utils/format";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPageRoute() {
  const user = await enforceRole(LEARNER_ROLES, "/dashboard");
  await connectToDatabase();

  const [summary, upcoming, students, tutors, favourites, conversations, requests] =
    await Promise.all([
      bookingSummary(user),
      listBookings(user, { scope: "UPCOMING", page: 1, pageSize: 4 }),
      listStudents(user),
      listMyTutors(user.id),
      listFavourites(user),
      listConversations(user, { pageSize: 4 }),
      listRequests(user, { status: "OPEN", pageSize: 3 }),
    ]);

  const firstName = user.firstName;
  const isParent = user.role === ROLES.PARENT;

  return (
    <DashboardPage>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={
          summary.nextLesson
            ? `Your next lesson is ${formatDateTime(summary.nextLesson.startAt, summary.nextLesson.timeZone)}.`
            : "No lessons booked yet — find a tutor to get started."
        }
        action={
          <>
            <Button href="/find-a-tutor" iconLeft={<Search className="size-4" />}>
              Find a tutor
            </Button>
            {isParent && students.length === 0 && (
              <Button href="/children?new=1" variant="secondary">
                Add a child
              </Button>
            )}
          </>
        }
      />

      {isParent && students.length === 0 && (
        <Alert
          tone="info"
          title="Add your child to start booking"
          className="mb-6"
          action={
            <Button href="/children?new=1" size="sm">
              Add a child
            </Button>
          }
        >
          We need their grade and courses so tutors can prepare properly.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Upcoming lessons"
          value={formatNumber(summary.upcoming)}
          icon={<CalendarDays className="size-5" />}
          href="/bookings"
        />
        <StatCard
          label="Lessons completed"
          value={formatNumber(summary.completed)}
          icon={<Star className="size-5" />}
          href="/bookings?scope=PAST"
        />
        <StatCard
          label="My tutors"
          value={formatNumber(tutors.length)}
          icon={<Users className="size-5" />}
          href="/tutors"
        />
        <StatCard
          label="Saved tutors"
          value={formatNumber(favourites.length)}
          icon={<Heart className="size-5" />}
          href="/favourites"
        />
      </div>

      {summary.awaitingReview > 0 && (
        <Alert
          tone="warning"
          title={`${summary.awaitingReview} ${summary.awaitingReview === 1 ? "lesson is" : "lessons are"} waiting for your review`}
          className="mt-6"
          action={
            <Button href="/bookings?scope=AWAITING_REVIEW" size="sm" variant="secondary">
              Leave a review
            </Button>
          }
        >
          Reviews help other families choose, and they only take a minute.
        </Alert>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <NextLessonCard booking={summary.nextLesson} />

          <Card>
            <CardHeader
              title="Upcoming lessons"
              action={
                upcoming.items.length > 0 && (
                  <Button href="/bookings" variant="ghost" size="sm" iconRight={<ArrowRight className="size-3.5" />}>
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
                  description="Search for a tutor by course code and book a time that works."
                  action={<Button href="/find-a-tutor" size="sm">Find a tutor</Button>}
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {upcoming.items.map((booking) => (
                    <li key={booking.id}>
                      <BookingRow booking={booking} viewerRole={user.role} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Messages"
              action={
                <Button href="/messages" variant="ghost" size="sm" iconRight={<ArrowRight className="size-3.5" />}>
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
                  title="No messages yet"
                  description="Message a tutor before booking — it's free."
                />
              ) : (
                <ul className="divide-y divide-ink-100">
                  {conversations.items.map((conversation) => (
                    <li key={conversation.id}>
                      <Link
                        href={`/messages/${conversation.id}`}
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

          <Card>
            <CardHeader
              title="My tutors"
              action={
                tutors.length > 0 && (
                  <Button href="/tutors" variant="ghost" size="sm" iconRight={<ArrowRight className="size-3.5" />}>
                    All
                  </Button>
                )
              }
            />
            <CardBody className="space-y-2">
              {tutors.length === 0 ? (
                <EmptyState
                  compact
                  className="border-0 bg-transparent"
                  icon={<Users className="size-5" />}
                  title="No tutors yet"
                  description="Tutors you book appear here for easy rebooking."
                />
              ) : (
                tutors.slice(0, 3).map((tutor) => (
                  <TutorCardCompact
                    key={tutor.id}
                    tutor={tutor}
                    action={
                      <Button href={`/tutors/${tutor.slug}#availability`} size="xs">
                        Rebook
                      </Button>
                    }
                  />
                ))
              )}
            </CardBody>
          </Card>

          {requests.items.length > 0 && (
            <Card>
              <CardHeader title="Open tutor requests" />
              <CardBody className="space-y-3">
                {requests.items.map((request) => (
                  <Link
                    key={request.id}
                    href={`/requests/${request.id}`}
                    className="block rounded-xl border border-ink-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <p className="text-sm font-semibold text-ink-900">
                      {request.courseCode ?? request.courseName}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
                      <Megaphone className="size-3" />
                      {request.interestedCount}{" "}
                      {request.interestedCount === 1 ? "tutor" : "tutors"} interested
                    </p>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </DashboardPage>
  );
}

/** Prominent "next lesson" panel with the join link when it's online (§24). */
function NextLessonCard({ booking }) {
  if (!booking) return null;

  const tutorUser = booking.tutorProfileId?.userId;
  const tutorName = tutorUser
    ? `${tutorUser.firstName} ${tutorUser.lastName?.charAt(0) ?? ""}.`
    : "Your tutor";
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
              src={tutorUser?.avatarUrl}
              firstName={tutorUser?.firstName}
              lastName={tutorUser?.lastName}
              size="lg"
            />
            <div className="min-w-0">
              <p className="text-base font-bold text-ink-900">
                {booking.courseCode ? `${booking.courseCode} — ` : ""}
                {booking.courseName}
              </p>
              <p className="mt-0.5 text-sm text-ink-600">with {tutorName}</p>
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
              {booking.studentProfileId && (
                <p className="mt-1 text-xs text-ink-500">
                  For {booking.studentProfileId.firstName}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2">
            {isOnline && (
              <JoinLessonButton
                startAt={booking.startAt}
                joinUrl={booking.meeting?.joinUrl}
              />
            )}
            <Button href={`/bookings/${booking.id}`} variant="secondary">
              Lesson details
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
