import { notFound } from "next/navigation";
import { ArrowLeft, FileText, MessageSquare } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { studentAnalytics } from "@/services/analytics.service";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { Button, LinkTabs } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { LearnerAnalytics } from "@/components/analytics/LearnerAnalytics";

export const metadata = { title: "Student" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "366", label: "12 months" },
];

/**
 * One student, as their tutor sees them (§24, §35, §41 Phase 3).
 *
 * The whole of the scoping lives in `studentAnalytics`: this tutor's own
 * lessons, this tutor's own reports, no money, and the learner's name masked
 * unless the family opted in. A tutor who has never completed a lesson with
 * this learner is refused there, and the refusal becomes a 404 here rather
 * than a message confirming that the learner exists.
 */
export default async function TutorStudentPage({ params, searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/students");
  await connectToDatabase();

  const { id } = await params;
  const { days = "90" } = await searchParams;
  const period = Number(days) || 90;

  let analytics;
  try {
    analytics = await studentAnalytics(id, user, { days: period });
  } catch (error) {
    // "Not yours" and "does not exist" are deliberately the same answer: a
    // distinguishable 403 would confirm which ids are real learners (§8).
    if (error instanceof AuthorizationError || error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <DashboardPage>
      <Button href="/tutor/students" variant="ghost" size="sm" className="-ml-2 mb-2">
        <ArrowLeft className="size-4" />
        All students
      </Button>

      <PageHeader
        title={analytics.learner.displayName}
        description={
          analytics.learner.gradeName
            ? `${analytics.learner.gradeName} · your lessons with them`
            : "Your lessons with them"
        }
        action={
          <>
            <Button href="/tutor/progress" variant="secondary" size="sm">
              <FileText className="size-4" />
              Progress reports
            </Button>
            <Button href="/tutor/messages" variant="ghost" size="sm">
              <MessageSquare className="size-4" />
              Messages
            </Button>
          </>
        }
      />

      <LinkTabs
        className="mb-6"
        activeValue={String(period)}
        tabs={PERIODS.map((p) => ({
          ...p,
          href: `/tutor/students/${id}?days=${p.value}`,
        }))}
      />

      <LearnerAnalytics analytics={analytics} />
    </DashboardPage>
  );
}
