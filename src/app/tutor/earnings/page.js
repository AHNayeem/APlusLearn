import Link from "next/link";
import { TrendingUp, Banknote, Clock, Receipt, Repeat, Star } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { tutorEarnings } from "@/services/payment.service";
import { tutorAnalytics } from "@/services/analytics.service";
import { getSettings } from "@/services/settings.service";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, LinkTabs, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatPercent } from "@/lib/utils/format";

export const metadata = { title: "Earnings" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
];

export default async function TutorEarningsPage({ searchParams }) {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/earnings");
  await connectToDatabase();

  const { days = "90" } = await searchParams;
  const [earnings, performance, settings] = await Promise.all([
    tutorEarnings(user.id, { days: Number(days) }),
    // The tutor's own analytics, resolved from the session — there is no id
    // in the URL that could point this at somebody else (§8, §10).
    tutorAnalytics(user.id, { days: Number(days) }),
    getSettings(),
  ]);

  const { lifetime, period, pendingPayoutCents, recentLessons, payoutAccount } = earnings;

  return (
    <DashboardPage>
      <PageHeader
        title="Earnings"
        description={`You keep ${100 - settings.commissionPercent}% of every completed lesson. The fee only applies when you actually teach.`}
        action={
          <Button href="/tutor/payouts" iconLeft={<Banknote className="size-4" />}>
            Payouts
          </Button>
        }
      />

      {!payoutAccount?.payoutsEnabled && (
        <Alert
          tone="warning"
          title="Set up payouts to get paid"
          className="mb-6"
          action={
            <Button href="/tutor/payouts" size="sm" variant="secondary">
              Set up now
            </Button>
          }
        >
          Your earnings are being tracked, but we can&rsquo;t send them until your payout account is
          connected.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={`Earned (${days === "365" ? "12 months" : `${days} days`})`}
          value={formatMoney(period.netCents, { compact: true })}
          hint={`${period.lessons} lessons`}
          icon={<TrendingUp className="size-5" />}
        />
        <StatCard
          label="Ready for payout"
          value={formatMoney(pendingPayoutCents, { compact: true })}
          hint={`After a ${settings.payoutHoldDays}-day hold`}
          icon={<Clock className="size-5" />}
          href="/tutor/payouts"
        />
        <StatCard
          label="Lifetime earnings"
          value={formatMoney(lifetime.netCents, { compact: true })}
          hint={`${lifetime.lessons} lessons taught`}
          icon={<Banknote className="size-5" />}
        />
        <StatCard
          label="Platform fees paid"
          value={formatMoney(lifetime.commissionCents, { compact: true })}
          hint={`${settings.commissionPercent}% of each lesson`}
          icon={<Receipt className="size-5" />}
        />
      </div>

      <div className="mt-6">
        <LinkTabs
          activeValue={days}
          tabs={PERIODS.map((p) => ({ ...p, href: `/tutor/earnings?days=${p.value}` }))}
        />
      </div>

      <h2 className="mb-4 mt-8 text-sm font-bold text-ink-900">How your teaching is going</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Lessons completed"
          value={performance.lessons.completed}
          trend={performance.lessons.completedChange}
          hint={`${performance.lessons.teachingHours} teaching hours`}
          icon={<TrendingUp className="size-5" />}
        />
        <StatCard
          label="Completion rate"
          value={`${performance.lessons.completionRate}%`}
          hint={
            performance.lessons.cancelledByMe > 0
              ? `${performance.lessons.cancelledByMe} cancelled by you`
              : "No lessons cancelled by you"
          }
        />
        <StatCard
          label="Students who came back"
          value={`${performance.students.repeatRate}%`}
          hint={`${performance.students.returning} of ${performance.students.taught} students`}
          icon={<Repeat className="size-5" />}
        />
        <StatCard
          label="Reviews in this period"
          value={performance.reviews.count}
          hint={
            performance.reviews.count
              ? `${performance.reviews.average} average`
              : "No reviews yet"
          }
          icon={<Star className="size-5" />}
          href="/tutor/reviews"
        />
      </div>

      {performance.courses.length > 0 && (
        <Card className="mt-6">
          <CardHeader
            title="Where your earnings come from"
            description="Completed lessons in this period, by course."
          />
          <CardBody className="p-0">
            <Table className="min-w-0">
              <THead>
                <TH>Course</TH>
                <TH align="center">Lessons</TH>
                <TH align="right">You earned</TH>
              </THead>
              <TBody>
                {performance.courses.map((course) => (
                  <TR key={`${course.code}-${course.name}`}>
                    <TD>
                      <span className="font-semibold text-ink-900">
                        {course.code ?? course.name}
                      </span>
                      {course.code && (
                        <span className="block text-xs text-ink-500">{course.name}</span>
                      )}
                    </TD>
                    <TD align="center">{course.lessons}</TD>
                    <TD align="right" className="font-semibold text-success-700">
                      {formatMoney(course.earningsCents)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Completed lessons"
          description="Every lesson you've been paid for, and what the platform fee was."
        />
        <CardBody className="p-0">
          {recentLessons.length === 0 ? (
            <EmptyState
              compact
              className="m-5 border-0 bg-transparent"
              icon={<TrendingUp className="size-6" />}
              title="No completed lessons in this period"
              description="Earnings appear here once a lesson is marked complete."
            />
          ) : (
            <Table className="min-w-[720px]">
              <THead>
                <TH>Lesson</TH>
                <TH>Completed</TH>
                <TH align="right">Family paid</TH>
                <TH align="right">Fee</TH>
                <TH align="right">You earned</TH>
                <TH align="right">Payout</TH>
              </THead>
              <TBody>
                {recentLessons.map((lesson) => (
                  <TR key={lesson.id}>
                    <TD>
                      <span className="block font-semibold text-ink-900">
                        {lesson.courseCode ?? lesson.courseName}
                      </span>
                      <span className="block text-xs text-ink-500">{lesson.reference}</span>
                    </TD>
                    <TD>{formatDate(lesson.completedAt ?? lesson.startAt)}</TD>
                    <TD align="right">{formatMoney(lesson.price.totalCents)}</TD>
                    <TD align="right" className="text-ink-500">
                      −{formatMoney(lesson.price.commissionCents)}
                    </TD>
                    <TD align="right">
                      <span className="font-bold text-success-700">
                        {formatMoney(lesson.price.tutorEarningsCents)}
                      </span>
                    </TD>
                    <TD align="right">
                      <Badge tone={lesson.payoutId ? "success" : "warning"} size="sm">
                        {lesson.payoutId ? "Paid out" : "Pending"}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </DashboardPage>
  );
}
