import {
  TrendingUp, Users, GraduationCap, CalendarDays, Banknote, MapPin, Video,
} from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { marketplaceOverview, marketplaceBreakdowns } from "@/services/analytics.service";
import {
  Card, CardBody, CardHeader, EmptyState, LinkTabs, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatNumber, formatPercent } from "@/lib/utils/format";

export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const PERIODS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
];

/**
 * Marketplace analytics (§25).
 *
 * Every panel answers an operational question — where supply is short, where
 * demand is growing, what the platform actually earns — rather than existing
 * to fill a chart.
 */
export default async function AdminAnalyticsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/analytics");
  await connectToDatabase();

  const { days = "30" } = await searchParams;
  const period = Number(days);

  const [overview, breakdowns] = await Promise.all([
    marketplaceOverview({ days: period }),
    marketplaceBreakdowns({ days: period, limit: 8 }),
  ]);

  const { supply, demand, commerce, health } = overview;
  const totalModes = breakdowns.lessonModes.online + breakdowns.lessonModes.inPerson;

  return (
    <DashboardPage>
      <PageHeader
        title="Analytics"
        description="Supply, demand and revenue across the marketplace."
      />

      <LinkTabs
        activeValue={days}
        tabs={PERIODS.map((p) => ({ ...p, href: `/admin/analytics?days=${p.value}` }))}
      />

      <h2 className="mb-4 mt-6 text-sm font-bold text-ink-900">Revenue</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross tutoring sales"
          value={formatMoney(commerce.grossSalesCents, { compact: true })}
          trend={commerce.grossChange}
          icon={<Banknote className="size-5" />}
        />
        <StatCard
          label="Platform revenue"
          value={formatMoney(commerce.platformRevenueCents, { compact: true })}
          hint="Commission earned"
          icon={<TrendingUp className="size-5" />}
        />
        <StatCard
          label="Paid to tutors"
          value={formatMoney(commerce.tutorEarningsCents, { compact: true })}
        />
        <StatCard
          label="Average booking"
          value={formatMoney(commerce.averageBookingValueCents, { compact: true })}
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

      <h2 className="mb-4 mt-8 text-sm font-bold text-ink-900">Lessons</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bookings"
          value={formatNumber(commerce.bookings)}
          trend={commerce.bookingChange}
          icon={<CalendarDays className="size-5" />}
        />
        <StatCard label="Completed" value={formatNumber(commerce.completedLessons)} />
        <StatCard
          label="Cancellation rate"
          value={`${commerce.cancellationRate}%`}
          hint={commerce.cancellationRate > 15 ? "Worth investigating" : "Healthy"}
        />
        <StatCard
          label="Open disputes"
          value={formatNumber(health.openDisputes)}
          href="/admin/disputes"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Bookings over time"
            description={`Daily bookings and revenue across the last ${period} days.`}
          />
          <CardBody>
            {breakdowns.dailyBookings.length === 0 ? (
              <EmptyState compact className="border-0 bg-transparent" title="No bookings yet" />
            ) : (
              <DailyChart data={breakdowns.dailyBookings} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Online vs in person"
            description="How families choose to learn."
          />
          <CardBody>
            {totalModes === 0 ? (
              <EmptyState compact className="border-0 bg-transparent" title="No bookings yet" />
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

        <Card>
          <CardHeader title="Popular subjects" description="What families book most." />
          <CardBody className="p-0">
            {breakdowns.popularSubjects.length === 0 ? (
              <EmptyState compact className="m-5 border-0 bg-transparent" title="No data yet" />
            ) : (
              <Table className="min-w-0">
                <THead>
                  <TH>Subject</TH>
                  <TH align="center">Bookings</TH>
                  <TH align="right">Revenue</TH>
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
                  <TH align="center">Bookings</TH>
                  <TH align="right">Revenue</TH>
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

        <Card className="lg:col-span-2">
          <CardHeader
            title="Active cities"
            description="Where approved tutors are based — useful for spotting supply gaps."
          />
          <CardBody>
            {breakdowns.activeCities.length === 0 ? (
              <EmptyState compact className="border-0 bg-transparent" title="No data yet" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
    </DashboardPage>
  );
}

/** Simple CSS bar chart — no charting library needed for this shape of data. */
function DailyChart({ data }) {
  const max = Math.max(...data.map((d) => d.bookings), 1);

  return (
    <div>
      <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily bookings">
        {data.map((day) => (
          <div key={day.date} className="group relative flex flex-1 flex-col justify-end">
            <div
              className="rounded-t bg-brand-500 transition-colors group-hover:bg-brand-600"
              style={{ height: `${Math.max(4, (day.bookings / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-900 px-2 py-1 text-[10px] text-white group-hover:block">
              {day.date}: {day.bookings} · {formatMoney(day.revenueCents, { compact: true })}
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
