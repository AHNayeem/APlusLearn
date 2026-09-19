import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Wallet, Clock, CalendarDays } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, LESSON_MODE_LABELS, AVAILABILITY_WINDOWS, REQUEST_STATUS,
  REQUEST_STATUS_LABELS, REQUEST_URGENCY_LABELS, QUALIFICATION_LABELS,
  MATCH_STATUS, MATCH_STATUS_LABELS,
} from "@/constants";
import { getRequestForTutor } from "@/services/request.service";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RequestInterestForm } from "@/components/tutor/RequestInterestForm";
import { RequestWithdrawButton } from "@/components/tutor/RequestWithdrawButton";
import { formatMoney, formatDate, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "Tutor request", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TutorRequestDetailPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(ROLES.TUTOR, `/tutor/requests/${id}`);
  await connectToDatabase();

  // The tutor's own view: the brief plus their match state. The service
  // decides whether they may see it at all — an invite-only request they were
  // never invited to reads as "not found" (§10).
  const view = await getRequestForTutor(id, user).catch(() => null);
  if (!view) notFound();

  const { request, match, canRespond } = view;
  const profile = await getTutorProfileByUserId(user.id);
  const student = request.studentProfileId;
  const hasResponded = Boolean(match?.message);
  const stepped = match && [MATCH_STATUS.TUTOR_DECLINED, MATCH_STATUS.WITHDRAWN].includes(match.status);

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/tutor/requests"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All requests
          </Link>
        }
        title={request.title || `${request.courseCode ? `${request.courseCode} — ` : ""}${request.courseName}`}
        description={`Posted ${formatDate(request.createdAt)} · ${request.interestedCount} ${request.interestedCount === 1 ? "tutor" : "tutors"} interested`}
        action={
          match && !stepped && request.status === REQUEST_STATUS.OPEN ? (
            <RequestWithdrawButton requestId={id} hasResponded={hasResponded} />
          ) : null
        }
      />

      {match?.status === MATCH_STATUS.INVITED && (
        <Alert tone="brand" title="You were invited to this request" className="mb-6">
          This family asked for you by name. Replying quickly makes a difference.
        </Alert>
      )}

      {match?.status === MATCH_STATUS.SHORTLISTED && (
        <Alert tone="success" title="You've been shortlisted" className="mb-6">
          The family is considering you. Keep an eye on your messages.
        </Alert>
      )}

      {stepped && (
        <Alert tone="neutral" title={MATCH_STATUS_LABELS[match.status]} className="mb-6">
          You stepped back from this request, so it will not appear in your list again.
        </Alert>
      )}

      {request.status !== REQUEST_STATUS.OPEN && (
        <Alert
          tone="neutral"
          title={`This request is ${(REQUEST_STATUS_LABELS[request.status] ?? "closed").toLowerCase()}`}
          className="mb-6"
        >
          The family is no longer accepting responses.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="What they're looking for" />
            <CardBody className="space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Goal</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{request.goal}</p>
              </div>

              {request.notes && (
                <div className="border-t border-ink-100 pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    Additional notes
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{request.notes}</p>
                </div>
              )}

              {(request.languages?.length > 0 ||
                request.minYearsExperience ||
                request.preferredQualifications?.length > 0) && (
                <div className="border-t border-ink-100 pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    What they&rsquo;re hoping for
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {request.languages?.map((language) => (
                      <Badge key={language} tone="neutral" size="sm">
                        Speaks {language}
                      </Badge>
                    ))}
                    {request.minYearsExperience ? (
                      <Badge tone="neutral" size="sm">
                        {request.minYearsExperience}+ years experience
                      </Badge>
                    ) : null}
                    {request.preferredQualifications?.map((value) => (
                      <Badge key={value} tone="neutral" size="sm">
                        {QUALIFICATION_LABELS[value] ?? value}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-ink-400">
                    Preferences, not requirements — you can still reply if they don&rsquo;t all apply.
                  </p>
                </div>
              )}

              <div className="border-t border-ink-100 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                  When they&rsquo;re free
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {request.preferredWindows?.map((value) => (
                    <Badge key={value} tone="neutral" size="sm">
                      {AVAILABILITY_WINDOWS.find((w) => w.value === value)?.label ?? value}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>

          {(canRespond || hasResponded) && request.status === REQUEST_STATUS.OPEN && (
            <RequestInterestForm
              request={request}
              alreadyResponded={hasResponded}
              hourlyRateCents={profile?.hourlyRateCents}
            />
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row
                icon={<Wallet className="size-3.5" />}
                label="Budget"
                value={`${request.budgetMinCents ? `${formatMoney(request.budgetMinCents, { compact: true })}–` : "up to "}${formatMoney(request.budgetMaxCents, { compact: true })}/hr`}
              />
              <Row
                icon={<Clock className="size-3.5" />}
                label="Frequency"
                value={`${request.sessionsPerWeek}× ${formatDuration(request.preferredDurationMinutes)} per week`}
              />
              <Row
                icon={<Clock className="size-3.5" />}
                label="Urgency"
                value={REQUEST_URGENCY_LABELS[request.urgency] ?? "No rush"}
              />
              <Row
                icon={<MapPin className="size-3.5" />}
                label="Lesson type"
                value={request.modes?.map((m) => LESSON_MODE_LABELS[m]).join(" or ")}
              />
              {request.city && (
                <Row
                  icon={<MapPin className="size-3.5" />}
                  label="Location"
                  value={`${request.city} · within ${request.maxDistanceKm} km`}
                />
              )}
              {request.startDate && (
                <Row
                  icon={<CalendarDays className="size-3.5" />}
                  label="Ideal start"
                  value={formatDate(request.startDate)}
                />
              )}
              {student && (
                <Row
                  icon={<CalendarDays className="size-3.5" />}
                  label="Student"
                  value={`${student.firstName} · ${student.gradeName ?? "Grade not set"}`}
                />
              )}
            </dl>

            <p className="mt-4 border-t border-ink-100 pt-4 text-xs leading-relaxed text-ink-400">
              Family contact details are only shared once they choose to message or book you.
            </p>
          </CardBody>
        </Card>
      </div>
    </DashboardPage>
  );
}

function Row({ icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-ink-400">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-ink-400">{label}</dt>
        <dd className="font-medium text-ink-700">{value}</dd>
      </div>
    </div>
  );
}
