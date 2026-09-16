import Link from "next/link";
import {
  Users, GraduationCap, CalendarDays, Banknote, ClipboardCheck, ShieldAlert,
  Star, TrendingUp, ArrowRight, Database,
} from "lucide-react";
import { connectToDatabase, databaseStatus } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, TUTOR_STATUS } from "@/constants";
import { marketplaceOverview, adminQueueCounts, recentActivity } from "@/services/analytics.service";
import { pendingPayoutSummary } from "@/services/payout.service";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, StatCard,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatNumber, formatRelative, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Admin overview" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await enforceRole(ROLES.ADMIN, "/admin/dashboard");
  await connectToDatabase();

  const [overview, queues, activity, pendingPayouts, db] = await Promise.all([
    marketplaceOverview({ days: 30 }),
    adminQueueCounts(),
    recentActivity({ limit: 6 }),
    pendingPayoutSummary(),
    databaseStatus(),
  ]);

  const payableTotal = pendingPayouts.reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <DashboardPage>
      <PageHeader
        title="Marketplace overview"
        description="The last 30 days, and everything waiting on a decision."
        action={
          <Button href="/admin/analytics" iconLeft={<TrendingUp className="size-4" />}>
            Full analytics
          </Button>
        }
      />

      {!db.connected && (
        <Alert tone="danger" title="Database connection problem" className="mb-6">
          {db.error}
        </Alert>
      )}

      {/* Action queues first — this is what an admin opens the console for. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <QueueCard
          label="Tutor applications"
          count={queues.pendingApplications}
          href="/admin/applications"
          icon={<ClipboardCheck className="size-5" />}
          tone={queues.pendingApplications > 0 ? "warning" : "neutral"}
        />
        <QueueCard
          label="Verification documents"
          count={queues.pendingVerifications}
          href="/admin/verification"
          icon={<GraduationCap className="size-5" />}
          tone={queues.pendingVerifications > 0 ? "warning" : "neutral"}
        />
        <QueueCard
          label="Open disputes"
          count={queues.openDisputes}
          href="/admin/disputes"
          icon={<ShieldAlert className="size-5" />}
          tone={queues.openDisputes > 0 ? "danger" : "neutral"}
        />
        <QueueCard
          label="Reported reviews"
          count={queues.reportedReviews}
          href="/admin/reviews?status=REPORTED"
          icon={<Star className="size-5" />}
          tone={queues.reportedReviews > 0 ? "warning" : "neutral"}
        />
      </div>

      <h2 className="mb-4 mt-8 text-sm font-bold text-ink-900">Last 30 days</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gross tutoring sales"
          value={formatMoney(overview.commerce.grossSalesCents, { compact: true })}
          trend={overview.commerce.grossChange}
          icon={<Banknote className="size-5" />}
        />
        <StatCard
          label="Platform revenue"
          value={formatMoney(overview.commerce.platformRevenueCents, { compact: true })}
          hint={`${formatMoney(overview.commerce.averageBookingValueCents, { compact: true })} avg booking`}
          icon={<TrendingUp className="size-5" />}
        />
        <StatCard
          label="Bookings"
          value={formatNumber(overview.commerce.bookings)}
          trend={overview.commerce.bookingChange}
          hint={`${overview.commerce.cancellationRate}% cancelled`}
          icon={<CalendarDays className="size-5" />}
          href="/admin/bookings"
        />
        <StatCard
          label="New registrations"
          value={formatNumber(overview.demand.newRegistrations)}
          trend={overview.demand.registrationChange}
          icon={<Users className="size-5" />}
          href="/admin/users"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Approved tutors"
          value={formatNumber(overview.supply.approvedTutors)}
          hint={`of ${overview.supply.registeredTutors} registered · ${overview.supply.approvalRate}%`}
          icon={<GraduationCap className="size-5" />}
          href="/admin/tutors"
        />
        <StatCard
          label="Active students"
          value={formatNumber(overview.demand.activeStudents)}
          hint={`${overview.demand.totalLearners} learner profiles`}
        />
        <StatCard
          label="Lessons completed"
          value={formatNumber(overview.commerce.completedLessons)}
        />
        <StatCard
          label="Owed to tutors"
          value={formatMoney(payableTotal, { compact: true })}
          hint={`${pendingPayouts.length} tutors`}
          icon={<Banknote className="size-5" />}
          href="/admin/payouts"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Applications waiting"
            action={
              <Button
                href="/admin/applications"
                variant="ghost"
                size="sm"
                iconRight={<ArrowRight className="size-3.5" />}
              >
                Review queue
              </Button>
            }
          />
          <CardBody className="p-0">
            {activity.applications.length === 0 ? (
              <EmptyState
                compact
                className="m-5 border-0 bg-transparent"
                icon={<ClipboardCheck className="size-6" />}
                title="Nothing waiting"
                description="Every tutor application has been reviewed."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {activity.applications.map((application) => (
                  <li key={application.id}>
                    <Link
                      href={`/admin/applications/${application.id}`}
                      className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-ink-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">
                          {application.userId?.firstName} {application.userId?.lastName}
                        </p>
                        <p className="truncate text-xs text-ink-500">
                          {application.userId?.email}
                        </p>
                      </div>
                      <Badge tone="warning" size="sm">
                        {formatRelative(application.submittedAt)}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recent bookings"
            action={
              <Button
                href="/admin/bookings"
                variant="ghost"
                size="sm"
                iconRight={<ArrowRight className="size-3.5" />}
              >
                All bookings
              </Button>
            }
          />
          <CardBody className="p-0">
            {activity.bookings.length === 0 ? (
              <EmptyState
                compact
                className="m-5 border-0 bg-transparent"
                icon={<CalendarDays className="size-6" />}
                title="No bookings yet"
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {activity.bookings.map((booking) => (
                  <li key={booking.id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {booking.courseCode ?? booking.courseName}
                      </p>
                      <p className="text-xs text-ink-500">
                        {booking.reference} · {formatDate(booking.startAt)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-ink-900">
                      {formatMoney(booking.price.totalCents)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="System"
          description="Runtime health of the services this deployment depends on."
        />
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SystemRow
              icon={<Database className="size-4" />}
              label="Database"
              ok={db.connected}
              value={db.connected ? `${db.name} @ ${db.host}` : db.error}
            />
            <SystemRow
              label="Payment provider"
              ok
              value={process.env.STRIPE_SECRET_KEY ? "Stripe" : "Development (mock)"}
            />
            <SystemRow
              label="Email provider"
              ok
              value={process.env.RESEND_API_KEY ? "Resend" : "Development (console)"}
            />
          </dl>
        </CardBody>
      </Card>
    </DashboardPage>
  );
}

function QueueCard({ label, count, href, icon, tone }) {
  const tones = {
    warning: "border-warning-100 bg-warning-50",
    danger: "border-danger-200 bg-danger-50",
    neutral: "border-ink-200 bg-white",
  };

  return (
    <Link
      href={href}
      className={`block rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md ${tones[tone]}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-600">{label}</p>
        <span className="text-ink-400">{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-ink-900 tabular-nums">{count}</p>
      <p className="mt-1 text-xs text-ink-500">
        {count === 0 ? "Nothing waiting" : `${count} awaiting review`}
      </p>
    </Link>
  );
}

function SystemRow({ icon, label, ok, value }) {
  return (
    <div className="flex gap-3">
      <span
        className={`mt-1 size-2 shrink-0 rounded-full ${ok ? "bg-success-500" : "bg-danger-500"}`}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <dt className="text-xs font-semibold uppercase tracking-wide text-ink-400">{label}</dt>
        <dd className="mt-0.5 truncate text-sm font-medium text-ink-700">{value}</dd>
      </div>
    </div>
  );
}
