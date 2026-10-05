import { Users } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, LEARNER_MODE_PREFERENCE_LABELS } from "@/constants";
import { listTutorRoster } from "@/services/student.service";
import { Avatar, Badge, Button, Card, CardBody, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Students" };
export const dynamic = "force-dynamic";

/**
 * The tutor's student roster (§23).
 *
 * Built by `listTutorRoster`: learners with a confirmed or completed lesson
 * only, a minor's surname reduced to an initial on the server, and earnings
 * from completed lessons net of refunds.
 */
export default async function TutorStudentsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/students");
  await connectToDatabase();

  const roster = await listTutorRoster(user);

  return (
    <DashboardPage>
      <PageHeader
        title="Students"
        description="Everyone you've taught, with what you covered and what's booked next."
      />

      {roster.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="No students yet"
          description="Students appear here once they book their first lesson with you."
          action={<Button href="/tutor/calendar">Check my availability</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roster.map((entry) => (
            <Card key={entry.id}>
              <CardBody>
                <div className="flex items-start gap-3">
                  <Avatar src={entry.avatarUrl} name={entry.displayName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold text-ink-900">
                      {entry.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {entry.gradeName ?? "Grade not set"}
                      {entry.school ? ` · ${entry.school}` : ""}
                    </p>
                    {entry.guardianName && (
                      <p className="mt-0.5 text-xs text-ink-400">Parent: {entry.guardianName}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {entry.courses
                    .filter((c) => c.name)
                    .slice(0, 3)
                    .map((course) => (
                      <Badge key={course.code ?? course.name} tone="neutral" size="sm">
                        {course.code ?? course.name}
                      </Badge>
                    ))}
                </div>

                <LearnerDetails learning={entry.learning} />

                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3 text-center">
                  <div>
                    <dt className="text-[11px] text-ink-400">Completed</dt>
                    <dd className="text-sm font-bold text-ink-900">{entry.completed}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-400">Upcoming</dt>
                    <dd className="text-sm font-bold text-ink-900">{entry.upcoming}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-400">Earned</dt>
                    <dd className="text-sm font-bold text-ink-900">
                      {formatMoney(entry.earningsCents, { compact: true })}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs text-ink-400">
                  {entry.nextLessonAt
                    ? `Next lesson ${formatRelative(entry.nextLessonAt)}`
                    : entry.lastLessonAt
                      ? `Last lesson ${formatRelative(entry.lastLessonAt)}`
                      : "No lessons yet"}
                </p>

                {/* Only a learner this tutor has actually completed a lesson
                    with has anything to show, and the page refuses the rest. */}
                {entry.completed > 0 && (
                  <Button
                    href={`/tutor/students/${entry.id}`}
                    variant="secondary"
                    size="sm"
                    fullWidth
                    className="mt-3"
                  >
                    View progress
                  </Button>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </DashboardPage>
  );
}

/**
 * What the family chose to share with the tutors they book (§5). Shown only
 * here, for learners with a confirmed lesson; never on anything public.
 */
function LearnerDetails({ learning }) {
  const marks =
    learning.currentMark != null || learning.targetMark != null
      ? [
          learning.currentMark != null ? `Now ${learning.currentMark}%` : null,
          learning.targetMark != null ? `aiming for ${learning.targetMark}%` : null,
        ]
          .filter(Boolean)
          .join(", ")
      : null;

  const rows = [
    learning.courses?.length ? ["Needs help with", learning.courses.join(", ")] : null,
    learning.lessonModePreference
      ? ["Prefers", LEARNER_MODE_PREFERENCE_LABELS[learning.lessonModePreference]]
      : null,
    marks ? ["Marks", marks] : null,
    learning.goals?.length
      ? ["Goals", learning.goals.map((g) => (g.achieved ? `${g.label} ✓` : g.label)).join(" · ")]
      : null,
    learning.areasForImprovement ? ["Areas to improve", learning.areasForImprovement] : null,
    learning.learningPreferences ? ["Learns best", learning.learningPreferences] : null,
    learning.notes ? ["Notes", learning.notes] : null,
  ].filter(Boolean);

  if (!rows.length && !learning.accessibilityNeeds) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.length > 0 && (
        <dl className="space-y-1.5 text-xs">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="font-semibold text-ink-700">{label}</dt>
              <dd className="line-clamp-2 leading-relaxed text-ink-500">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {learning.accessibilityNeeds && (
        <div className="rounded-lg border border-info-100 bg-info-50 p-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-info-600">Learning needs</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{learning.accessibilityNeeds}</p>
        </div>
      )}
    </div>
  );
}
