import Link from "next/link";
import {
  TrendingUp, Users, GraduationCap, CalendarDays, Banknote, MapPin, Video,
  Megaphone, Package, Gift, Sparkles, FileText, ShieldAlert,
} from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import {
  marketplaceOverview,
  marketplaceBreakdowns,
  phaseTwoAnalytics,
  tutorLeaderboard,
} from "@/services/analytics.service";
import {
  Card, CardBody, CardHeader, EmptyState, LinkTabs, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatNumber, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "366", label: "12 months" },
];

const GRANULARITY_LABEL = { day: "day", week: "week", month: "month" };

/**
 * Marketplace analytics (§25, §41 Phase 2).
 *
 * Every panel answers an operational question — where supply is short, where
 * demand is growing, what the platform actually keeps, and whether the
 * Phase 2 features are earning their place — rather than existing to fill a
 * chart. Every figure on this page is aggregated in MongoDB from stored
 * payment and booking state; none of it is computed from a page of rows.
 */
export default async function AdminAnalyticsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/analytics");
  await connectToDatabase();

  const { days = "30" } = await searchParams;
  const period = Number(days) || 30;
  const query = { days: period };

  const [overview, breakdowns, phaseTwo, leaderboard] = await Promise.all([
    marketplaceOverview(query),
    marketplaceBreakdowns({ ...query, limit: 8 }),
    phaseTwoAnalytics(query),
    tutorLeaderboard({ ...query, limit: 8 }),
  ]);

  const { supply, demand, commerce, reliability, health } = overview;
  const totalModes = breakdowns.lessonModes.online + breakdowns.lessonModes.inPerson;

  return (
    <DashboardPage>
      <PageHeader
        title="Analytics"
        description={`Supply, demand and revenue across the marketplace. Periods are measured in ${overview.period.timeZone}.`}
      />

      <LinkTabs
        activeValue={days}
        tabs={PERIODS.map((p) => ({ ...p, href: `/admin/analytics?days=${p.value}` }))}
      />

      <p className="mt-3 text-xs text-ink-500">
        {formatDate(overview.period.from)} to {formatDate(overview.period.to)} · money is counted
        from settled payments on the day they were paid, and refunds are subtracted.
      </p>

      <h2 className="mb-4 mt-6 text-sm font-bold text-ink-900">Revenue</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross tutoring sales"
          value={formatMoney(commerce.grossSalesCents, { compact: true })}
          trend={commerce.grossChange}
          hint={`${formatNumber(commerce.payments)} settled payments`}
          icon={<Banknote className="size-5" />}
        />
        <StatCard
          label="Platform revenue"
          value={formatMoney(commerce.platformRevenueCents, { compact: true })}
          trend={commerce.platformRevenueChange}
          hint="Commission, less refunds and credit"
          icon={<TrendingUp className="size-5" />}
        />
        <StatCard
          label="Paid to tutors"
          value={formatMoney(commerce.tutorEarningsCents, { compact: true })}
        />
        <StatCard
          label="Refunded"
          value={formatMoney(commerce.refundedCents, { compact: true })}
          hint={`${formatMoney(commerce.netCollectedCents, { compact: true })} net collected`}
        />
      </div>

      <h2 className="mb-4 mt-8 text-sm font-bold text-ink-900">Supply and demand</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Approved tutors"
          value={formatNumber(supply.approvedTutors)}
          hint={`${supply.approvalRate}% of ${supply.registeredTutors} registered`}
          icon={<GraduationCap className="size-5" />}
        />
        <StatCard
          label="Pending applications"
          value={formatNumber(supply.pendingApplications)}
          href="/admin/applications"
        />
        <StatCard
          label="Active students"
          value={formatNumber(demand.activeStudents)}
          hint={`booked in the last ${period} days`}
          icon={<Users className="size-5" />}
        />
        <StatCard
          label="New registrations"
          value={formatNumber(demand.newRegistrations)}
          trend={demand.registrationChange}
        />
      </div>

      <h2 className="mb-4 mt-8 text-sm font-bold text-ink-900">Lessons and reliability</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Lessons scheduled"
          value={formatNumber(commerce.bookings)}
          trend={commerce.bookingChange}
          hint={`${formatNumber(commerce.teachingHours)} teaching hours delivered`}
          icon={<CalendarDays className="size-5" />}
        />
        <StatCard
          label="Completion rate"
          value={`${commerce.completionRate}%`}
          hint={`${formatNumber(commerce.completedLessons)} completed`}
        />
        <StatCard
          label="Cancellation rate"
          value={`${commerce.cancellationRate}%`}
          hint={`${reliability.cancelledByStudent} by learners, ${reliability.cancelledByTutor} by tutors`}
        />
        <StatCard
          label="No-show rate"
          value={`${commerce.noShowRate}%`}
          hint={`${reliability.tutorNoShows} tutor, ${reliability.studentNoShows} learner`}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open disputes"
          value={formatNumber(health.openDisputes)}
          hint={`${reliability.disputeRate}% of lessons disputed`}
          href="/admin/disputes"
          icon={<ShieldAlert className="size-5" />}
        />
        <StatCard
          label="Average lesson value"
          value={formatMoney(commerce.averageBookingValueCents, { compact: true })}
        />
        <StatCard
          label="Referral credit granted"
          value={formatMoney(phaseTwo.referrals.creditGrantedCents, { compact: true })}
          hint="Funded by commission, not by tutors"
          href="/admin/referrals"
          icon={<Gift className="size-5" />}
        />
        <StatCard
          label="Promotions running"
          value={formatNumber(supply.promotedNow)}
          href="/admin/promotions"
          icon={<Megaphone className="size-5" />}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Lessons over time"
            description={`Grouped by ${GRANULARITY_LABEL[breakdowns.granularity]} across the last ${period} days.`}
          />
          <CardBody>
            {breakdowns.dailyBookings.length === 0 ? (
              <EmptyState compact className="border-0 bg-transparent" title="No lessons yet" />
            ) : (
              <SeriesChart data={breakdowns.dailyBookings} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Online vs in person" description="How families choose to learn." />
          <CardBody>
            {totalModes === 0 ? (
              <EmptyState compact className="border-0 bg-transparent" title="No lessons yet" />
            ) : (
              <div className="space-y-5">
                <ModeBar
                  icon={<Video className="size-4" />}
                  label="Online"
                  count={breakdowns.lessonModes.online}
                  total={totalModes}
                  tone="bg-brand-600"
                />
                <ModeBar
                  icon={<MapPin className="size-4" />}
                  label="In person"
                  count={breakdowns.lessonModes.inPerson}
                  total={totalModes}
                  tone="bg-accent-500"
                />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <h2 className="mb-4 mt-8 text-sm font-bold text-ink-900">
        Requests, packages, groups and referrals
      </h2>
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <RatioCard
          icon={<Sparkles className="size-4" />}
          title="Tutor requests"
          headline={`${phaseTwo.requests.matchRate}%`}
          headlineLabel="matched to a tutor"
          href="/admin/requests"
          rows={[
            ["Created", formatNumber(phaseTwo.requests.created)],
            ["Still open", formatNumber(phaseTwo.requests.open)],
            ["Expired", formatNumber(phaseTwo.requests.expired)],
            ["Suggestions each", formatNumber(phaseTwo.requests.averageSuggestions)],
            ["Suggestions booked", `${phaseTwo.matching.bookingRate}%`],
          ]}
        />
        <RatioCard
          icon={<Package className="size-4" />}
          title="Packages"
          headline={`${phaseTwo.packages.utilisationRate}%`}
          headlineLabel="of bought lessons used"
          href="/admin/packages"
          rows={[
            ["On sale", formatNumber(phaseTwo.packages.onSale)],
            ["Purchases", formatNumber(phaseTwo.packages.purchases)],
            ["Lessons sold", formatNumber(phaseTwo.packages.sessionsSold)],
            ["Expired unused", formatNumber(phaseTwo.packages.expiredUnused)],
            ["Refunded", formatMoney(phaseTwo.packages.refundedCents, { compact: true })],
          ]}
        />
        <RatioCard
          icon={<Users className="size-4" />}
          title="Group sessions"
          headline={`${phaseTwo.groups.fillRate}%`}
          headlineLabel="of seats filled"
          href="/admin/groups"
          rows={[
            ["Sessions", formatNumber(phaseTwo.groups.sessions)],
            ["Went ahead", formatNumber(phaseTwo.groups.confirmed + phaseTwo.groups.completed)],
            ["Cancelled", `${phaseTwo.groups.cancellationRate}%`],
            ["Enrolments", formatNumber(phaseTwo.groups.enrolments)],
            ["Seats offered", formatNumber(phaseTwo.groups.seatsOffered)],
          ]}
        />
        <RatioCard
          icon={<Gift className="size-4" />}
          title="Referrals"
          headline={`${phaseTwo.referrals.conversionRate}%`}
          headlineLabel="of sign-ups qualified"
          href="/admin/referrals"
          rows={[
            ["Sign-ups", formatNumber(phaseTwo.referrals.signups)],
            ["Rewarded", formatNumber(phaseTwo.referrals.rewarded)],
            ["Reversed", formatNumber(phaseTwo.referrals.reversed)],
            ["Flagged for review", formatNumber(phaseTwo.referrals.flagged)],
            ["Credit granted", formatMoney(phaseTwo.referrals.creditGrantedCents, { compact: true })],
          ]}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Most active tutors"
            description="Lessons delivered in this period, and how reliably."
          />
          <CardBody className="p-0">
            {leaderboard.tutors.length === 0 ? (
              <EmptyState compact className="m-5 border-0 bg-transparent" title="No data yet" />
            ) : (
              <Table className="min-w-0">
                <THead>
                  <TH>Tutor</TH>
                  <TH align="center">Completed</TH>
                  <TH align="center">Completion</TH>
                  <TH align="right">Earned</TH>
                </THead>
                <TBody>
                  {leaderboard.tutors.map((tutor) => (
                    <TR key={tutor.tutorUserId}>
                      <TD className="font-semibold text-ink-900">{tutor.name}</TD>
                      <TD align="center">{tutor.completed}</TD>
                      <TD align="center">
                        <span
                          className={
                            tutor.completionRate < 70 ? "font-semibold text-warning-700" : ""
                          }
                        >
                          {tutor.completionRate}%
                        </span>
                      </TD>
                      <TD align="right">
                        {formatMoney(tutor.earningsCents, { compact: true })}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Popular subjects" description="What families book most." />
          <CardBody className="p-0">
            {breakdowns.popularSubjects.length === 0 ? (
              <EmptyState compact className="m-5 border-0 bg-transparent" title="No data yet" />
            ) : (
              <Table className="min-w-0">
                <THead>
                  <TH>Subject</TH>
                  <TH align="center">Lessons</TH>
                  <TH align="right">Value</TH>
                </THead>
                <TBody>
                  {breakdowns.popularSubjects.map((subject) => (
                    <TR key={subject.name}>
                      <TD className="font-semibold text-ink-900">{subject.name}</TD>
                      <TD align="center">{subject.bookings}</TD>
                      <TD align="right">{formatMoney(subject.revenueCents, { compact: true })}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Popular courses" description="Where demand concentrates." />
          <CardBody className="p-0">
            {breakdowns.popularCourses.length === 0 ? (
              <EmptyState compact className="m-5 border-0 bg-transparent" title="No data yet" />
            ) : (
              <Table className="min-w-0">
                <THead>
                  <TH>Course</TH>
                  <TH align="center">Lessons</TH>
                  <TH align="right">Value</TH>
                </THead>
                <TBody>
                  {breakdowns.popularCourses.map((course) => (
                    <TR key={`${course.code}-${course.name}`}>
                      <TD>
                        <span className="font-semibold text-ink-900">
                          {course.code ?? course.name}
                        </span>
                        {course.code && (
                          <span className="block text-xs text-ink-500">{course.name}</span>
                        )}
                      </TD>
                      <TD align="center">{course.bookings}</TD>
                      <TD align="right">{formatMoney(course.revenueCents, { compact: true })}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Active cities"
            description="Where approved tutors are based — useful for spotting supply gaps."
          />
          <CardBody>
            {breakdowns.activeCities.length === 0 ? (
              <EmptyState compact className="border-0 bg-transparent" title="No data yet" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {breakdowns.activeCities.map((city) => (
                  <div key={city.city} className="rounded-xl border border-ink-200 p-4">
                    <p className="text-sm font-semibold text-ink-900">{city.city}</p>
                    <p className="mt-1 text-2xl font-bold text-ink-900 tabular-nums">
                      {city.tutors}
                    </p>
                    <p className="text-xs text-ink-500">
                      {city.tutors === 1 ? "tutor" : "tutors"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="mt-8 flex items-center gap-2 text-xs text-ink-400">
        <FileText className="size-3.5" />
        {formatNumber(phaseTwo.progressReports.shared)} progress reports were shared with families
        in this period.
      </p>
    </DashboardPage>
  );
}

/** Simple CSS bar chart — no charting library needed for this shape of data. */
function SeriesChart({ data }) {
  const max = Math.max(...data.map((d) => d.bookings), 1);

  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label="Lessons over time">
        {data.map((point) => (
          <div key={point.date} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-brand-500 transition-colors group-hover:bg-brand-600"
              style={{ height: `${Math.max(4, (point.bookings / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-2 py-1 text-[10px] text-white group-hover:block">
              {point.date}: {point.bookings} · {point.completed} done ·{" "}
              {formatMoney(point.revenueCents, { compact: true })}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink-400">
        <span>{data[0]?.date}</span>
        <span>{data.at(-1)?.date}</span>
      </div>
    </div>
  );
}

function ModeBar({ icon, label, count, total, tone }) {
  const percent = Math.round((count / total) * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium text-ink-700">
          <span className="text-ink-400">{icon}</span>
          {label}
        </span>
        <span className="font-bold text-ink-900 tabular-nums">
          {count} <span className="font-normal text-ink-500">({percent}%)</span>
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-ink-100">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** One Phase 2 feature: the rate that matters, then the counts behind it. */
function RatioCard({ icon, title, headline, headlineLabel, rows, href }) {
  return (
    <Card>
      <CardHeader
        title={title}
        action={
          href ? (
            <Link href={href} className="text-xs font-semibold text-brand-700 hover:underline">
              Open
            </Link>
          ) : null
        }
      />
      <CardBody>
        <p className="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-ink-900 tabular-nums">
          <span className="text-ink-300">{icon}</span>
          {headline}
        </p>
        <p className="mt-0.5 text-xs text-ink-500">{headlineLabel}</p>
        <dl className="mt-4 space-y-1.5 border-t border-ink-100 pt-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 text-xs">
              <dt className="text-ink-500">{label}</dt>
              <dd className="font-semibold text-ink-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
