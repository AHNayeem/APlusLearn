import {
  CalendarCheck, Clock, Target, Trophy, TrendingUp, Wallet, UserX, Users,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  Badge, Card, CardBody, CardHeader, EmptyState, RatingBar, StatCard,
} from "@/components/ui";
import { formatMoney, formatNumber, formatPercent, formatDate } from "@/lib/utils/format";
import { PROGRESS_RATINGS, PROGRESS_RATING_LABELS } from "@/constants";

/**
 * One learner's analytics (§24, §41 Phase 3).
 *
 * Presentational only: the numbers arrive already aggregated and already
 * scoped by `analytics.service`, which is the single place that decided how
 * much of a learner's history this reader is entitled to. The component's
 * contribution is honesty about what it is showing —
 *
 *   a period with no lessons renders as an empty state rather than as a flat
 *   line, because "nothing happened" and "we have no data" look identical on
 *   a chart and are not the same thing;
 *
 *   a rating nobody has given renders as "not rated", never as zero;
 *
 *   and a tutor's scoped view says out loud that it is scoped, so a tutor
 *   reading "4 lessons" does not take it for the learner's whole term.
 */

/** The bar chart, drawn from the series the service bucketed. */
function LessonSeries({ series, granularity }) {
  const peak = Math.max(...series.map((point) => point.lessons), 1);

  return (
    <div>
      <div className="flex h-36 items-end gap-1" role="img" aria-label={`Lessons per ${granularity}`}>
        {series.map((point) => {
          const height = Math.round((point.lessons / peak) * 100);
          return (
            <div key={point.date} className="group relative flex min-w-0 flex-1 flex-col justify-end">
              <div
                className="w-full rounded-t-sm bg-brand-200"
                style={{ height: `${Math.max(height, point.lessons ? 6 : 2)}%` }}
              >
                <div
                  className="w-full rounded-t-sm bg-brand-600"
                  style={{
                    height: point.lessons
                      ? `${Math.round((point.completed / point.lessons) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
              <span className="sr-only">
                {point.date}: {point.completed} of {point.lessons} lessons completed
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-400">
        <span>{series[0]?.date}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-brand-600" aria-hidden="true" />
            Completed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-brand-200" aria-hidden="true" />
            Booked
          </span>
        </span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function LearnerAnalytics({ analytics }) {
  const { lessons, feedback, goals, courses, spend, period, scope } = analytics;
  const scoped = scope === "TUTOR";

  const ratings = Object.values(PROGRESS_RATINGS)
    .map((key) => ({ key, label: PROGRESS_RATING_LABELS[key], value: feedback[key] }))
    .filter((entry) => entry.value !== null && entry.value !== undefined);

  // Nothing at all in this window is a thing to say, not a set of zeroes to
  // draw. The period is still named, so it is obvious *which* window is empty.
  if (lessons.total === 0 && feedback.reports === 0) {
    return (
      <div className="space-y-4">
        {scoped && <ScopeNote />}
        <EmptyState
          icon={<CalendarCheck className="size-7" />}
          title="No lessons in this period"
          description={`Nothing was booked between ${formatDate(period.from)} and ${formatDate(period.to)}. Try a longer period, or check back after the next lesson.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {scoped && <ScopeNote />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Lessons completed"
          value={formatNumber(lessons.completed)}
          trend={lessons.completedChange}
          hint={`of ${formatNumber(lessons.total)} booked`}
          icon={<CalendarCheck className="size-5" />}
        />
        <StatCard
          label="Hours learned"
          value={formatNumber(lessons.hoursLearned)}
          hint={lessons.inGroup > 0 ? `${lessons.inGroup} in a group` : undefined}
          icon={<Clock className="size-5" />}
        />
        <StatCard
          label="Attendance"
          value={
            lessons.completed + lessons.missed === 0 ? "—" : formatPercent(lessons.attendanceRate)
          }
          hint={
            lessons.missed > 0
              ? `${lessons.missed} missed`
              : lessons.completed > 0
                ? "Every lesson attended"
                : "No lessons yet"
          }
          icon={<UserX className="size-5" />}
        />
        {spend ? (
          <StatCard
            label="Spent on lessons"
            value={formatMoney(spend.netCents, { compact: true })}
            hint={
              spend.refundedCents > 0
                ? `after ${formatMoney(spend.refundedCents, { compact: true })} refunded`
                : "lessons only — packages are household-wide"
            }
            icon={<Wallet className="size-5" />}
          />
        ) : (
          <StatCard
            label="Goals achieved"
            value={`${formatNumber(goals.achieved)}/${formatNumber(goals.total)}`}
            hint={goals.total === 0 ? "No goals set yet" : `${goals.open} still open`}
            icon={<Target className="size-5" />}
          />
        )}
      </div>

      {analytics.series.length > 0 && (
        <Card>
          <CardHeader
            title="Lessons over time"
            description={`Grouped by ${analytics.granularity}.`}
          />
          <CardBody>
            <LessonSeries series={analytics.series} granularity={analytics.granularity} />
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="What they worked on"
            description={scoped ? "Lessons you taught." : "By lessons completed."}
          />
          <CardBody>
            {courses.length === 0 ? (
              <p className="text-sm text-ink-400">No completed lessons in this period.</p>
            ) : (
              <ul className="space-y-3">
                {courses.map((course) => (
                  <li
                    key={`${course.code ?? ""}-${course.name ?? ""}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-800">
                        {course.name ?? course.code ?? "Lesson"}
                      </p>
                      {course.code && course.name && (
                        <p className="text-xs text-ink-400">{course.code}</p>
                      )}
                    </div>
                    <Badge tone="neutral" size="sm">
                      {course.lessons} lesson{course.lessons === 1 ? "" : "s"} · {course.hours}h
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Tutor feedback"
            description={
              feedback.reports === 0
                ? "From progress reports."
                : `Averaged across ${feedback.reports} report${feedback.reports === 1 ? "" : "s"}.`
            }
          />
          <CardBody>
            {ratings.length === 0 ? (
              <p className="text-sm text-ink-400">
                {feedback.reports === 0
                  ? "No progress reports were shared in this period."
                  : "The reports in this period did not include ratings."}
              </p>
            ) : (
              <div className="space-y-3">
                {ratings.map((entry) => (
                  <RatingBar key={entry.key} label={entry.label} value={entry.value} max={5} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat
          icon={<Target className="size-4" />}
          label="Goals achieved"
          value={`${goals.achieved} of ${goals.total}`}
          hint={goals.total === 0 ? "No learning goals set" : undefined}
        />
        <MiniStat
          icon={<Trophy className="size-4" />}
          label="Milestones earned"
          value={formatNumber(goals.milestones)}
          hint="Recorded by tutors in this period"
        />
        {scoped ? (
          <MiniStat
            icon={<TrendingUp className="size-4" />}
            label="Lessons you cancelled"
            value={formatNumber(lessons.cancelled - lessons.cancelledByUs)}
            hint="Your own cancellations of this learner's lessons"
          />
        ) : (
          <MiniStat
            icon={<Users className="size-4" />}
            label="Tutors worked with"
            value={formatNumber(analytics.tutors.count)}
            hint="With at least one completed lesson"
          />
        )}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4">
      <p className="flex items-center gap-2 text-xs font-medium text-ink-500">
        <span className="text-ink-300">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-400">{hint}</p>}
    </div>
  );
}

/**
 * Says plainly that a tutor is looking at their own slice.
 *
 * Without it the honest scoping in the service reads, on screen, as a claim
 * about the learner's whole term — which it is not.
 */
function ScopeNote({ className }) {
  return (
    <p
      className={cn(
        "rounded-xl border border-info-100 bg-info-50 px-4 py-3 text-sm text-ink-600",
        className,
      )}
    >
      This is <strong className="font-semibold">your teaching only</strong>. Lessons with other
      tutors, their reports, and anything the family has paid are not shown here.
    </p>
  );
}
