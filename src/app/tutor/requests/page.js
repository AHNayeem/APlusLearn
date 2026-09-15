import Link from "next/link";
import { Megaphone, MapPin, Wallet, Clock } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, LESSON_MODE_LABELS, AVAILABILITY_WINDOWS } from "@/constants";
import { listOpenRequestsForTutor } from "@/services/request.service";
import { Alert, Badge, Button, Card, CardBody, EmptyState, Pagination } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatRelative, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "Tutor requests" };
export const dynamic = "force-dynamic";

export default async function TutorRequestsPage({ searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/requests");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize, requiresApproval } = await listOpenRequestsForTutor(user, {
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Tutor requests"
        description="Families looking for someone who teaches your courses. Respond quickly — the first good reply usually wins."
      />

      {requiresApproval && (
        <Alert
          tone="warning"
          title="Your profile needs approval first"
          className="mb-6"
          action={
            <Button href="/tutor/onboarding" size="sm" variant="secondary">
              Finish application
            </Button>
          }
        >
          You can respond to requests once our team has approved your profile.
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="size-7" />}
          title="No open requests right now"
          description="We'll notify you when a family posts a request for one of your courses."
          action={<Button href="/tutor/calendar">Update my availability</Button>}
        />
      ) : (
        <>
          <div className="space-y-4">
            {items.map((request) => (
              <Card key={request.id} interactive>
                <CardBody>
                  <Link href={`/tutor/requests/${request.id}`} className="block">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-ink-900">
                            {request.courseCode ? `${request.courseCode} — ` : ""}
                            {request.courseName}
                          </h2>
                          {request.matchScore && (
                            <Badge tone={request.matchScore >= 80 ? "success" : "neutral"} size="sm">
                              {request.matchScore}% match
                            </Badge>
                          )}
                          {request.hasResponded && (
                            <Badge tone="brand" size="sm">
                              You responded
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-ink-500">
                          Posted {formatRelative(request.createdAt)} ·{" "}
                          {request.interestedCount}{" "}
                          {request.interestedCount === 1 ? "tutor" : "tutors"} interested
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-600">
                      {request.goal}
                    </p>

                    <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-ink-100 pt-3 text-xs">
                      <Fact
                        icon={<Wallet className="size-3" />}
                        label="Budget"
                        value={`up to ${formatMoney(request.budgetMaxCents, { compact: true })}/hr`}
                      />
                      <Fact
                        icon={<Clock className="size-3" />}
                        label="Frequency"
                        value={`${request.sessionsPerWeek}× ${formatDuration(request.preferredDurationMinutes)}`}
                      />
                      <Fact
                        icon={<MapPin className="size-3" />}
                        label="Type"
                        value={request.modes.map((m) => LESSON_MODE_LABELS[m]).join(" or ")}
                      />
                      {request.city && (
                        <Fact
                          icon={<MapPin className="size-3" />}
                          label="Location"
                          value={request.city}
                        />
                      )}
                    </dl>
                  </Link>
                </CardBody>
              </Card>
            ))}
          </div>

          <Pagination
            className="mt-6"
            page={Number(page)}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            total={total}
            pageSize={pageSize}
            label="requests"
            buildHref={(p) => `/tutor/requests?page=${p}`}
          />
        </>
      )}
    </DashboardPage>
  );
}

function Fact({ icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-ink-400">{icon}</span>
      <span>
        <dt className="sr-only">{label}</dt>
        <dd className="font-semibold text-ink-700">{value}</dd>
      </span>
    </div>
  );
}
