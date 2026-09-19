import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Clock, Wallet, CalendarDays } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  LEARNER_ROLES, REQUEST_STATUS, REQUEST_STATUS_LABELS, LESSON_MODE_LABELS,
  AVAILABILITY_WINDOWS, REQUEST_URGENCY_LABELS, REQUEST_VISIBILITY,
  REQUEST_VISIBILITY_LABELS, QUALIFICATION_LABELS,
} from "@/constants";
import { getRequest, listMatches } from "@/services/request.service";
import { Alert, Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { MatchComparison } from "@/components/dashboard/MatchComparison";
import { RequestActions } from "@/components/dashboard/RequestActions";
import { formatMoney, formatDate, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "Tutor request", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function RequestDetailPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/requests/${id}`);
  await connectToDatabase();

  const request = await getRequest(id, user).catch(() => null);
  if (!request) notFound();

  const matches = await listMatches(id, user);

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/requests"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            My requests
          </Link>
        }
        title={request.title || `${request.courseCode ? `${request.courseCode} — ` : ""}${request.courseName}`}
        description={`Request ${request.reference} · ${REQUEST_STATUS_LABELS[request.status]}${request.editCount ? ` · edited ${request.editCount}×` : ""}`}
        action={
          request.status === REQUEST_STATUS.OPEN && (
            <RequestActions requestId={id} matches={matches} />
          )
        }
      />

      {request.status === REQUEST_STATUS.REMOVED && (
        <Alert tone="danger" title="This request was removed" className="mb-6">
          {request.moderationNote ||
            "Our team removed this request from the tutor board. Contact support if you think this was a mistake."}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 lg:order-1">
          <MatchComparison matches={matches} requestId={id} request={request} />
        </div>

        <Card className="h-fit lg:order-2">
          <CardHeader title="Your request" />
          <CardBody className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Goal</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-600">{request.goal}</p>
            </div>

            <dl className="space-y-3 border-t border-ink-100 pt-4 text-sm">
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
                value={request.modes.map((m) => LESSON_MODE_LABELS[m]).join(" or ")}
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
                  label="Start"
                  value={formatDate(request.startDate)}
                />
              )}
            </dl>

            <div className="border-t border-ink-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Visibility
              </p>
              <p className="mt-1 text-sm font-medium text-ink-700">
                {REQUEST_VISIBILITY_LABELS[request.visibility] ??
                  REQUEST_VISIBILITY_LABELS[REQUEST_VISIBILITY.PUBLIC]}
              </p>
              <p className="mt-1 text-xs text-ink-500">
                {request.suggestedCount ?? 0} suggested · {request.invitedCount ?? 0} invited ·{" "}
                {request.viewCount ?? 0} viewed
              </p>
            </div>

            {(request.languages?.length > 0 ||
              request.minYearsExperience ||
              request.preferredQualifications?.length > 0) && (
              <div className="border-t border-ink-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Tutor preferences
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {request.languages?.map((language) => (
                    <Badge key={language} tone="neutral" size="sm">
                      {language}
                    </Badge>
                  ))}
                  {request.minYearsExperience ? (
                    <Badge tone="neutral" size="sm">
                      {request.minYearsExperience}+ years
                    </Badge>
                  ) : null}
                  {request.preferredQualifications?.map((value) => (
                    <Badge key={value} tone="neutral" size="sm">
                      {QUALIFICATION_LABELS[value] ?? value}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-ink-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                Preferred times
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {request.preferredWindows.map((value) => (
                  <Badge key={value} tone="neutral" size="sm">
                    {AVAILABILITY_WINDOWS.find((w) => w.value === value)?.label ?? value}
                  </Badge>
                ))}
              </div>
            </div>

            {request.notes && (
              <div className="border-t border-ink-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Notes</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{request.notes}</p>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </DashboardPage>
  );
}

function Row({ icon, label, value }) {
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
