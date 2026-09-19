import { notFound } from "next/navigation";
import Link from "next/link";
import { Users, Clock, MapPin, Video, CalendarDays, ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getGroupSession } from "@/services/group.service";
import { listStudents } from "@/services/student.service";
import {
  LEARNER_ROLES, LESSON_MODES, GROUP_SESSION_STATUS, GROUP_SESSION_STATUS_LABELS,
  GROUP_ENROLMENT_STATUS, GROUP_ENROLMENT_STATUS_LABELS, ATTENDANCE_LABELS,
} from "@/constants";
import {
  Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, Progress,
} from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { JoinGroupButton } from "@/components/groups/JoinGroupButton";
import { AttendanceForm } from "@/components/groups/AttendanceForm";
import { JoinLessonButton } from "@/components/booking/JoinLessonButton";
import { formatMoney, formatDate, formatTime, formatDuration } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }) {
  const { id } = await params;
  await connectToDatabase();
  const result = await getGroupSession(id, null).catch(() => null);
  if (!result) return { title: "Group session" };

  return {
    title: result.session.title,
    description:
      result.session.description?.slice(0, 160) ??
      `A small-group lesson with a verified Canadian tutor.`,
  };
}

/**
 * One group session (§41 Phase 2).
 *
 * The roster is only rendered for the tutor and administrators — who else is
 * in a class is not a family's business, and a minor's name least of all
 * (§35). The service decides that; this page only renders what it was given.
 */
export default async function GroupSessionPage({ params }) {
  const { id } = await params;
  await connectToDatabase();

  const user = await getCurrentUser();
  const result = await getGroupSession(id, user).catch(() => null);
  if (!result) notFound();

  const { session, meeting, myEnrolments, roster, canManage } = result;
  const isLearner = Boolean(user && LEARNER_ROLES.includes(user.role));
  const students = isLearner ? await listStudents(user) : [];

  const myActive = myEnrolments.filter(
    (e) => e.status !== GROUP_ENROLMENT_STATUS.CANCELLED,
  );
  const cancelled = session.status === GROUP_SESSION_STATUS.CANCELLED;
  const finished = session.status === GROUP_SESSION_STATUS.COMPLETED;

  return (
    <div className="bg-canvas pb-16">
      <PageHero
        eyebrow={session.courseCode ?? session.courseName}
        title={session.title}
        description={`${formatDate(session.startAt, { weekday: "long" })} at ${formatTime(session.startAt, session.timeZone)} · ${formatDuration(session.durationMinutes)}`}
      >
        <Link
          href="/groups"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
        >
          <ArrowLeft className="size-3.5" />
          All group sessions
        </Link>
      </PageHero>

      <div className="container-page">
        {cancelled && (
          <Alert tone="danger" title="This session was cancelled" className="mb-6">
            {session.cancellationReason ?? "The tutor cancelled it."} Anybody who paid has been
            refunded in full.
          </Alert>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader title="What happens" />
              <CardBody className="space-y-4">
                {session.description ? (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">
                    {session.description}
                  </p>
                ) : (
                  <p className="text-sm text-ink-500">
                    The tutor hasn&rsquo;t added a description for this session.
                  </p>
                )}

                <dl className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-2">
                  <Fact
                    icon={<CalendarDays className="size-3.5" />}
                    label="When"
                    value={`${formatDate(session.startAt, { weekday: "long" })}, ${formatTime(session.startAt, session.timeZone)}`}
                  />
                  <Fact
                    icon={<Clock className="size-3.5" />}
                    label="How long"
                    value={formatDuration(session.durationMinutes)}
                  />
                  <Fact
                    icon={
                      session.mode === LESSON_MODES.ONLINE ? (
                        <Video className="size-3.5" />
                      ) : (
                        <MapPin className="size-3.5" />
                      )
                    }
                    label="Where"
                    value={
                      session.mode === LESSON_MODES.ONLINE
                        ? "Online"
                        : (session.location?.label ?? "In person")
                    }
                  />
                  <Fact
                    icon={<Users className="size-3.5" />}
                    label="Group size"
                    value={`${session.minParticipants}–${session.maxParticipants} learners`}
                  />
                </dl>
              </CardBody>
            </Card>

            {meeting?.joinUrl && (
              <Card>
                <CardHeader
                  title="Joining the session"
                  description="The same room for everybody. It opens shortly before the start time."
                />
                <CardBody>
                  <JoinLessonButton booking={{ meeting, startAt: session.startAt }} />
                </CardBody>
              </Card>
            )}

            {canManage && roster.length > 0 && (
              <Card>
                <CardHeader
                  title={`Who's coming (${roster.filter((r) => r.status !== GROUP_ENROLMENT_STATUS.WAITLISTED).length})`}
                  description="Only you and our team can see this."
                />
                <CardBody className="p-0">
                  <ul className="divide-y divide-ink-100">
                    {roster.map((entry) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-800">{entry.studentName}</p>
                          {entry.gradeName && (
                            <p className="text-xs text-ink-500">{entry.gradeName}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {entry.attendance && (
                            <Badge
                              tone={entry.attendance === "PRESENT" ? "success" : "warning"}
                              size="sm"
                            >
                              {ATTENDANCE_LABELS[entry.attendance]}
                            </Badge>
                          )}
                          <Badge
                            tone={
                              entry.status === GROUP_ENROLMENT_STATUS.CONFIRMED
                                ? "success"
                                : "neutral"
                            }
                            size="sm"
                          >
                            {entry.status === GROUP_ENROLMENT_STATUS.WAITLISTED
                              ? `Waiting · ${entry.waitlistPosition}`
                              : GROUP_ENROLMENT_STATUS_LABELS[entry.status]}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            )}

            {canManage && finished === false && session.endAt < new Date().toISOString() && (
              <AttendanceForm sessionId={session.id} roster={roster} />
            )}
          </div>

          <Card className="h-fit lg:sticky lg:top-24">
            <CardBody className="space-y-4">
              <div>
                <p className="text-3xl font-extrabold text-ink-900">
                  {formatMoney(session.pricePerSeatCents)}
                </p>
                <p className="text-xs text-ink-500">per learner</p>
              </div>

              <Badge tone={cancelled ? "danger" : "neutral"}>
                {GROUP_SESSION_STATUS_LABELS[session.status]}
              </Badge>

              <Progress
                value={session.seatsTaken}
                max={session.maxParticipants}
                tone={session.seatsTaken >= session.minParticipants ? "success" : "warning"}
                label={
                  session.seatsRemaining > 0
                    ? `${session.seatsRemaining} of ${session.maxParticipants} seats left`
                    : "Full"
                }
              />

              {session.seatsTaken < session.minParticipants && !cancelled && (
                <p className="text-xs leading-relaxed text-ink-500">
                  Needs {session.minParticipants} learners to run. If it doesn&rsquo;t fill up by{" "}
                  {formatDate(session.confirmBy, { weekday: "short" })}, it is cancelled and
                  everybody is refunded in full.
                </p>
              )}

              {session.tutor && (
                <Link
                  href={`/tutors/${session.tutor.slug}`}
                  className="flex items-center gap-3 rounded-xl border border-ink-200 p-3 transition hover:border-brand-200"
                >
                  <Avatar src={session.tutor.avatarUrl} name={session.tutor.displayName} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-800">
                      {session.tutor.displayName}
                    </p>
                    <p className="text-xs text-ink-500">View profile</p>
                  </div>
                </Link>
              )}

              {myActive.length > 0 ? (
                <Alert
                  tone={
                    myActive[0].status === GROUP_ENROLMENT_STATUS.WAITLISTED ? "neutral" : "success"
                  }
                  title={
                    myActive[0].status === GROUP_ENROLMENT_STATUS.WAITLISTED
                      ? `You're on the waiting list${myActive[0].waitlistPosition ? ` — position ${myActive[0].waitlistPosition}` : ""}`
                      : "You're in this session"
                  }
                >
                  {myActive[0].status === GROUP_ENROLMENT_STATUS.PENDING_PAYMENT
                    ? "Finish paying to confirm your seat."
                    : myActive[0].status === GROUP_ENROLMENT_STATUS.WAITLISTED
                      ? "Nothing has been charged. We'll tell you if a seat opens up."
                      : "See it in your lessons."}
                </Alert>
              ) : (
                !cancelled &&
                !finished && (
                  <JoinGroupButton
                    session={session}
                    students={students.map((student) => ({
                      id: student.id,
                      firstName: student.firstName,
                      gradeName: student.gradeName,
                    }))}
                    signedIn={isLearner}
                    alreadyJoined={false}
                  />
                )
              )}

              <p className="text-xs leading-relaxed text-ink-400">
                Cancel with enough notice and the usual refund policy applies. If the session
                doesn&rsquo;t run, you are refunded in full.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-ink-400">{label}</dt>
        <dd className="text-sm font-medium text-ink-700">{value}</dd>
      </div>
    </div>
  );
}
