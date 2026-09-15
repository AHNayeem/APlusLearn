import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Wallet, Clock, CalendarDays } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, LESSON_MODE_LABELS, AVAILABILITY_WINDOWS, REQUEST_STATUS,
} from "@/constants";
import { getRequest } from "@/services/request.service";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import { TutorMatch } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RequestInterestForm } from "@/components/tutor/RequestInterestForm";
import { formatMoney, formatDate, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "Tutor request", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TutorRequestDetailPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(ROLES.TUTOR, `/tutor/requests/${id}`);
  await connectToDatabase();

  const request = await getRequest(id, user).catch(() => null);
  if (!request) notFound();

  const profile = await getTutorProfileByUserId(user.id);
  const match = profile
    ? toPlain(await TutorMatch.findOne({ requestId: id, tutorProfileId: profile.id }).lean())
    : null;

  const student = request.studentProfileId;

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
        title={`${request.courseCode ? `${request.courseCode} — ` : ""}${request.courseName}`}
        description={`Posted ${formatDate(request.createdAt)} · ${request.interestedCount} ${request.interestedCount === 1 ? "tutor" : "tutors"} interested`}
      />

      {request.status !== REQUEST_STATUS.OPEN && (
        <Alert tone="neutral" title="This request is closed" className="mb-6">
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

          {request.status === REQUEST_STATUS.OPEN && (
            <RequestInterestForm
              request={request}
              alreadyResponded={Boolean(match?.message)}
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
