import { FileText } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PROGRESS_REPORT_STATUS, PROGRESS_REPORT_STATUS_LABELS } from "@/constants";
import { listAllProgressReports } from "@/services/progress.service";
import {
  Alert, Badge, Card, CardBody, EmptyState, Pagination,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Progress reports" };
export const dynamic = "force-dynamic";

/**
 * Shared progress reports, for support (§35, §41 Phase 2).
 *
 * Drafts are deliberately absent — a tutor's unfinished thinking is not
 * something support has a reason to read — and so are private notes, which
 * are never selected outside the author's own view.
 */
export default async function AdminProgressPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/progress");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize } = await listAllProgressReports({ page: Number(page) });

  return (
    <DashboardPage>
      <PageHeader
        title="Progress reports"
        description="Reports tutors have shared with families."
      />

      <Alert tone="neutral" title="Drafts and private notes are not shown here" className="mb-6">
        A report reaches this list only once a tutor has shared it with a family. A tutor&rsquo;s
        private notes are never loaded outside their own view.
      </Alert>

      <Card>
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<FileText className="size-7" />}
              title="No shared reports yet"
              description="Reports appear here once tutors start sharing them."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Shared</TH>
                  <TH>Tutor</TH>
                  <TH>Student</TH>
                  <TH>Course</TH>
                  <TH>Lessons</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((report) => (
                  <TR key={report.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {report.submittedAt ? formatRelative(report.submittedAt) : "—"}
                    </TD>
                    <TD className="text-xs">
                      {report.tutorUserId?.firstName} {report.tutorUserId?.lastName}
                    </TD>
                    <TD className="text-xs">{report.studentProfileId?.firstName}</TD>
                    <TD className="text-xs">{report.courseCode ?? report.courseName ?? "—"}</TD>
                    <TD className="text-xs">{report.lessonCount}</TD>
                    <TD>
                      <Badge
                        tone={
                          report.status === PROGRESS_REPORT_STATUS.SUBMITTED ? "success" : "neutral"
                        }
                        size="sm"
                      >
                        {PROGRESS_REPORT_STATUS_LABELS[report.status]}
                      </Badge>
                      {report.revisions?.length > 0 && (
                        <span className="ml-1 text-[11px] text-ink-400">
                          {report.revisions.length} revision
                          {report.revisions.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="reports"
        buildHref={(p) => `/admin/progress?page=${p}`}
      />
    </DashboardPage>
  );
}
