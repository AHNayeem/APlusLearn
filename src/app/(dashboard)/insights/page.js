import Link from "next/link";
import { LineChart, Users } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listStudents } from "@/services/student.service";
import { studentAnalytics } from "@/services/analytics.service";
import { Avatar, Button, EmptyState, LinkTabs } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { LearnerAnalytics } from "@/components/analytics/LearnerAnalytics";
import { cn } from "@/lib/utils/cn";

export const metadata = { title: "Learning insights" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "6 months" },
  { value: "366", label: "12 months" },
];

/**
 * A family's view of how a learner is doing (§24, §41 Phase 3).
 *
 * Server-rendered against the service directly, the way every other dashboard
 * page is, so there is no client fetch to show a spinner for and no second
 * copy of the authorization. `studentAnalytics` decides what this account may
 * see from the learner's stored `ownerId` — the id in the URL is a selection,
 * never a claim, and a learner belonging to somebody else raises rather than
 * renders.
 *
 * A parent picks between children; a self-serve student has exactly one
 * learner and never sees the picker.
 */
export default async function InsightsPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/insights");
  await connectToDatabase();

  const { learner, days = "90" } = await searchParams;
  const students = await listStudents(user);

  if (!students.length) {
    return (
      <DashboardPage>
        <PageHeader
          title="Learning insights"
          description="Attendance, hours and how tutors rate progress — drawn from your actual lessons."
        />
        <EmptyState
          icon={<Users className="size-7" />}
          title="No learners yet"
          description="Add the person who'll be taking lessons, and their insights build up as lessons happen."
          action={<Button href="/children">Add a learner</Button>}
        />
      </DashboardPage>
    );
  }

  const selected = students.find((s) => s.id === learner) ?? students[0];
  const period = Number(days) || 90;
  const analytics = await studentAnalytics(selected.id, user, { days: period });

  const href = (params) =>
    `/insights?learner=${params.learner ?? selected.id}&days=${params.days ?? period}`;

  return (
    <DashboardPage>
      <PageHeader
        title="Learning insights"
        description="Attendance, hours and how tutors rate progress — drawn from your actual lessons."
      />

      {students.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {students.map((student) => (
            <Link
              key={student.id}
              href={href({ learner: student.id })}
              aria-current={student.id === selected.id ? "true" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors",
                student.id === selected.id
                  ? "border-brand-300 bg-brand-50 text-brand-800"
                  : "border-ink-200 bg-white text-ink-600 hover:border-ink-300",
              )}
            >
              <Avatar
                src={student.avatarUrl}
                firstName={student.firstName}
                lastName={student.lastName}
                size="sm"
              />
              {student.firstName}
            </Link>
          ))}
        </div>
      )}

      <LinkTabs
        className="mb-6"
        activeValue={String(period)}
        tabs={PERIODS.map((p) => ({ ...p, href: href({ days: p.value }) }))}
      />

      <LearnerAnalytics analytics={analytics} />

      <p className="mt-6 flex items-center gap-2 text-xs text-ink-400">
        <LineChart className="size-3.5" aria-hidden="true" />
        Every figure here comes from lessons that were actually booked and reports your tutors
        actually wrote. Nothing is estimated.
      </p>
    </DashboardPage>
  );
}
