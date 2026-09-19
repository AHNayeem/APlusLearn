import Link from "next/link";
import { FileText, CheckCircle2 } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listReportsForOwner } from "@/services/progress.service";
import { Avatar, Badge, Button, Card, CardBody, EmptyState, Pagination } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatDate, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

/** A family's progress history. Only shared reports appear (§41 Phase 2). */
export default async function ProgressPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/progress");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize, unread } = await listReportsForOwner(user, {
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Progress"
        description="What your tutors say has changed, lesson block by lesson block."
      />

      {unread > 0 && (
        <p className="mb-4 text-sm font-semibold text-brand-700">
          {unread} report{unread === 1 ? "" : "s"} you haven&rsquo;t read yet.
        </p>
      )}

      <div className="space-y-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-7" />}
            title="No progress reports yet"
            description="Your tutor can write one after a run of lessons. It's the clearest picture of how things are going."
            action={
              <Button href="/bookings" variant="secondary">
                See your lessons
              </Button>
            }
          />
        ) : (
          items.map((report) => (
            <Card key={report.id} interactive>
              <CardBody>
                <Link href={`/progress/${report.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        src={report.tutorProfileId?.avatarUrl}
                        name={report.tutorProfileId?.displayName ?? "Tutor"}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-bold text-ink-900">
                            {report.studentProfileId?.firstName}
                            {report.courseCode ? ` · ${report.courseCode}` : ""}
                          </h2>
                          {report.acknowledgedAt ? (
                            <Badge tone="neutral" size="sm" icon={<CheckCircle2 className="size-3" />}>
                              Read
                            </Badge>
                          ) : (
                            <Badge tone="brand" size="sm">
                              New
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-ink-500">
                          From {report.tutorProfileId?.displayName} ·{" "}
                          {report.lessonCount} lesson{report.lessonCount === 1 ? "" : "s"} ·{" "}
                          shared {formatRelative(report.submittedAt)}
                        </p>
                      </div>
                    </div>

                    {report.periodStart && (
                      <p className="text-xs text-ink-400">
                        {formatDate(report.periodStart)} – {formatDate(report.periodEnd)}
                      </p>
                    )}
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-600">
                    {report.summary}
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
        buildHref={(p) => `/progress?page=${p}`}
      />
    </DashboardPage>
  );
}
