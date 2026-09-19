import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PROGRESS_REPORT_STATUS_LABELS } from "@/constants";
import { getProgressReport } from "@/services/progress.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ProgressReportEditor } from "@/components/progress/ProgressReportEditor";

export const metadata = { title: "Progress report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function TutorProgressReportPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(ROLES.TUTOR, `/tutor/progress/${id}`);
  await connectToDatabase();

  const result = await getProgressReport(id, user).catch(() => null);
  if (!result?.canEdit) notFound();

  const { report } = result;

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/tutor/progress"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All reports
          </Link>
        }
        title={`Report for ${report.studentProfileId?.displayName ?? "your student"}`}
        description={`${report.reference} · ${PROGRESS_REPORT_STATUS_LABELS[report.status]}`}
      />

      <div className="max-w-3xl">
        <ProgressReportEditor report={report} />
      </div>
    </DashboardPage>
  );
}
