import Link from "next/link";
import { Megaphone, Plus, Users } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, REQUEST_STATUS, REQUEST_STATUS_LABELS } from "@/constants";
import { listRequests } from "@/services/request.service";
import { Badge, Button, Card, CardBody, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Tutor requests" };
export const dynamic = "force-dynamic";

function statusTone(status) {
  if (status === REQUEST_STATUS.OPEN) return "success";
  if (status === REQUEST_STATUS.MATCHED) return "brand";
  return "neutral";
}

export default async function RequestsPage() {
  const user = await enforceRole(LEARNER_ROLES, "/requests");
  await connectToDatabase();

  const { items } = await listRequests(user, { pageSize: 30 });

  return (
    <DashboardPage>
      <PageHeader
        title="Tutor requests"
        description="Describe what you need once, and let matching tutors come to you."
        action={
          <Button href="/requests/new" iconLeft={<Plus className="size-4" />}>
            Post a request
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="size-7" />}
          title="No requests yet"
          description="A request is useful when you want tutors to come to you — especially for a niche course or a tight schedule."
          action={<Button href="/requests/new">Post a request</Button>}
          secondaryAction={
            <Button href="/find-a-tutor" variant="secondary">
              Search instead
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {items.map((request) => (
            <Card key={request.id} interactive>
              <CardBody>
                <Link href={`/requests/${request.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-ink-900">
                          {request.courseCode ? `${request.courseCode} — ` : ""}
                          {request.courseName}
                        </h2>
                        <Badge tone={statusTone(request.status)} size="sm">
                          {REQUEST_STATUS_LABELS[request.status]}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        For {request.studentProfileId?.firstName} · Posted{" "}
                        {formatRelative(request.createdAt)} · Ref {request.reference}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {request.interestedCount > 0 ? (
                        <Badge tone="brand" icon={<Users className="size-3" />}>
                          {request.interestedCount}{" "}
                          {request.interestedCount === 1 ? "tutor" : "tutors"} interested
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Waiting for responses</Badge>
                      )}
                    </div>
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-600">
                    {request.goal}
                  </p>

                  <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-ink-100 pt-3 text-xs">
                    <div>
                      <dt className="text-ink-400">Budget</dt>
                      <dd className="font-semibold text-ink-700">
                        up to {formatMoney(request.budgetMaxCents, { compact: true })}/hr
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-400">Frequency</dt>
                      <dd className="font-semibold text-ink-700">
                        {request.sessionsPerWeek}× per week
                      </dd>
                    </div>
                    {request.startDate && (
                      <div>
                        <dt className="text-ink-400">Start</dt>
                        <dd className="font-semibold text-ink-700">
                          {formatDate(request.startDate)}
                        </dd>
                      </div>
                    )}
                    {request.expiresAt && request.status === REQUEST_STATUS.OPEN && (
                      <div>
                        <dt className="text-ink-400">Expires</dt>
                        <dd className="font-semibold text-ink-700">
                          {formatDate(request.expiresAt)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </Link>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </DashboardPage>
  );
}
