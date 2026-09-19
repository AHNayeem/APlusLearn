import Link from "next/link";
import { FileText, CheckCircle2 } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PROGRESS_REPORT_STATUS, PROGRESS_REPORT_STATUS_LABELS } from "@/constants";
import { listReportsForTutor, reportableStudents } from "@/services/progress.service";
import { Badge, Card, CardBody, EmptyState, LinkTabs, Pagination } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { NewProgressReport } from "@/components/progress/NewProgressReport";
import { formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Progress reports" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: PROGRESS_REPORT_STATUS.DRAFT, label: "Drafts" },
  { value: PROGRESS_REPORT_STATUS.SUBMITTED, label: "Shared" },
  { value: PROGRESS_REPORT_STATUS.ARCHIVED, label: "Archived" },
];

function tone(status) {
  if (status === PROGRESS_REPORT_STATUS.SUBMITTED) return "success";
  if (status === PROGRESS_REPORT_STATUS.DRAFT) return "warning";
  return "neutral";
}

/** A tutor's progress reports (§41 Phase 2). */
export default async function TutorProgressPage({ searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/progress");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const [{ items, total, pageSize }, { students }] = await Promise.all([
    listReportsForTutor(user, { status: status || undefined, page: Number(page) }),
    reportableStudents(user),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Progress reports"
        description="Tell families what changed. A draft is yours alone until you share it."
        action={<NewProgressReport students={students} />}
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/tutor/progress?status=${tab.value}` : "/tutor/progress",
        }))}
      />

      <div className="mt-6 space-y-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-7" />}
            title="No reports yet"
            description={
              students.length
                ? "Write one after a run of lessons — families notice, and it makes rebooking easy."
                : "Once you've completed a lesson with someone, you can write them a progress report."
            }
          />
        ) : (
          items.map((report) => (
            <Card key={report.id} interactive>
              <CardBody>
                <Link href={`/tutor/progress/${report.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold text-ink-900">
                          {report.studentProfileId?.displayName ?? "Student"}
                        </h2>
                        <Badge tone={tone(report.status)} size="sm">
                          {PROGRESS_REPORT_STATUS_LABELS[report.status]}
                        </Badge>
                        {report.acknowledgedAt && (
                          <Badge tone="brand" size="sm" icon={<CheckCircle2 className="size-3" />}>
                            Read
                          </Badge>
                        )}
                        {report.revisions?.length > 0 && (
                          <Badge tone="neutral" size="sm">
                            {report.revisions.length} revision
                            {report.revisions.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        {report.courseCode ? `${report.courseCode} · ` : ""}
                        {report.lessonCount} lesson{report.lessonCount === 1 ? "" : "s"} ·{" "}
                        updated {formatRelative(report.updatedAt)}
                      </p>
                    </div>
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-600">
                    {report.summary || "No summary written yet."}
                  </p>
                </Link>
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
        label="reports"
        buildHref={(p) => `/tutor/progress?status=${status}&page=${p}`}
      />
    </DashboardPage>
  );
}
