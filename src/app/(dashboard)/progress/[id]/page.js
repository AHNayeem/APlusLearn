import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { getProgressReport } from "@/services/progress.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ProgressReportView } from "@/components/progress/ProgressReportView";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Progress report", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ProgressReportPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/progress/${id}`);
  await connectToDatabase();

  const result = await getProgressReport(id, user).catch(() => null);
  if (!result) notFound();

  const { report, canAcknowledge } = result;

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/progress"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All progress
          </Link>
        }
        title={`${report.studentProfileId?.firstName ?? "Progress"}${report.courseCode ? ` · ${report.courseCode}` : ""}`}
        description={
          report.submittedAt ? `Shared ${formatDate(report.submittedAt)}` : report.reference
        }
      />

      <div className="max-w-3xl">
        <ProgressReportView report={report} canAcknowledge={canAcknowledge} />
      </div>
    </DashboardPage>
  );
}
