import { Megaphone, Users, Eye } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, REQUEST_STATUS, REQUEST_STATUS_LABELS, REQUEST_VISIBILITY,
  REQUEST_VISIBILITY_LABELS,
} from "@/constants";
import { listAllRequests } from "@/services/request.service";
import {
  Badge, Card, CardBody, EmptyState, LinkTabs, Pagination,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RequestModeration } from "@/components/admin/RequestModeration";
import { formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Tutor requests" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: REQUEST_STATUS.OPEN, label: "Open" },
  { value: REQUEST_STATUS.MATCHED, label: "Matched" },
  { value: REQUEST_STATUS.REMOVED, label: "Removed" },
  { value: "", label: "All" },
];

function statusTone(status) {
  if (status === REQUEST_STATUS.OPEN) return "success";
  if (status === REQUEST_STATUS.MATCHED) return "brand";
  if (status === REQUEST_STATUS.REMOVED) return "danger";
  return "neutral";
}

/** Moderation queue for the reverse marketplace (§23, §41 Phase 2). */
export default async function AdminRequestsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/requests");
  await connectToDatabase();

  const { status = REQUEST_STATUS.OPEN, page = "1", search = "" } = await searchParams;
  const { items, total, pageSize } = await listAllRequests({
    status: status || undefined,
    search: search || undefined,
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Tutor requests"
        description="Every request families have posted. Removing one takes it off the tutor board without destroying what tutors wrote."
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/requests?status=${tab.value}` : "/admin/requests",
        }))}
      />

      <div className="mt-6 space-y-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="size-7" />}
            title="Nothing here"
            description="No requests match this filter."
          />
        ) : (
          items.map((request) => (
            <Card key={request.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-ink-900">
                        {request.title ||
                          `${request.courseCode ? `${request.courseCode} — ` : ""}${request.courseName}`}
                      </h2>
                      <Badge tone={statusTone(request.status)} size="sm">
                        {REQUEST_STATUS_LABELS[request.status]}
                      </Badge>
                      {request.visibility === REQUEST_VISIBILITY.INVITE_ONLY && (
                        <Badge tone="neutral" size="sm">
                          {REQUEST_VISIBILITY_LABELS[REQUEST_VISIBILITY.INVITE_ONLY]}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-500">
                      {request.ownerId?.firstName} {request.ownerId?.lastName} ·{" "}
                      {request.ownerId?.email} · Ref {request.reference} ·{" "}
                      {formatRelative(request.createdAt)}
                    </p>
                  </div>

                  <RequestModeration request={request} />
                </div>

                <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-600">
                  {request.goal}
                </p>

                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-ink-100 pt-3 text-xs">
                  <Fact
                    icon={<Users className="size-3" />}
                    label="Responses"
                    value={`${request.interestedCount ?? 0} interested · ${request.invitedCount ?? 0} invited`}
                  />
                  <Fact
                    icon={<Eye className="size-3" />}
                    label="Views"
                    value={`${request.viewCount ?? 0} tutor views`}
                  />
                  <Fact
                    icon={<Megaphone className="size-3" />}
                    label="Budget"
                    value={`up to ${formatMoney(request.budgetMaxCents, { compact: true })}/hr`}
                  />
                </dl>

                {request.moderationNote && (
                  <p className="mt-3 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
                    <span className="font-semibold">Moderation note:</span>{" "}
                    {request.moderationNote}
                  </p>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="requests"
        buildHref={(p) => `/admin/requests?status=${status}&page=${p}`}
      />
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
