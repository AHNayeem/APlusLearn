import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Phone, MapPin, Clock } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, ROLE_LABELS, USER_STATUS, TUTOR_STATUS_LABELS } from "@/constants";
import { getUserDetail } from "@/services/user.service";
import { listAuditLogs } from "@/services/audit.service";
import { Avatar, Badge, Card, CardBody, CardHeader, StatCard } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { UserActions } from "@/components/admin/UserActions";
import { formatDate, formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "User details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminUserDetailPage({ params }) {
  const { id } = await params;
  await enforceRole(ROLES.ADMIN, `/admin/users/${id}`);
  await connectToDatabase();

  const detail = await getUserDetail(id).catch(() => null);
  if (!detail) notFound();

  const { user, tutorProfile, students, bookingCount, lifetimeSpendCents } = detail;
  const audit = await listAuditLogs({ entityType: "User", entityId: id, limit: 20 });

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/admin/users"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All users
          </Link>
        }
        title={`${user.firstName} ${user.lastName}`}
        description={`${ROLE_LABELS[user.role]} · joined ${formatDate(user.createdAt)}`}
        action={<UserActions user={user} />}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Bookings" value={bookingCount} />
            <StatCard
              label={user.role === ROLES.TUTOR ? "Lessons taught" : "Lifetime spend"}
              value={
                user.role === ROLES.TUTOR
                  ? (tutorProfile?.stats?.completedLessons ?? 0)
                  : formatMoney(lifetimeSpendCents, { compact: true })
              }
            />
            <StatCard
              label={user.role === ROLES.TUTOR ? "Rating" : "Learners"}
              value={
                user.role === ROLES.TUTOR
                  ? (tutorProfile?.stats?.ratingCount
                      ? tutorProfile.stats.ratingAverage.toFixed(1)
                      : "—")
                  : students.length
              }
            />
          </div>

          {tutorProfile && (
            <Card>
              <CardHeader
                title="Tutor profile"
                action={
                  <div className="flex items-center gap-2">
                    <Badge tone={tutorProfile.isSearchable ? "success" : "warning"}>
                      {tutorProfile.isSearchable ? "Live in search" : "Not searchable"}
                    </Badge>
                    <Badge tone="neutral">{TUTOR_STATUS_LABELS[tutorProfile.status]}</Badge>
                  </div>
                }
              />
              <CardBody className="space-y-4">
                <p className="text-sm font-semibold text-ink-900">{tutorProfile.headline}</p>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <Row label="Hourly rate" value={formatMoney(tutorProfile.hourlyRateCents)} />
                  <Row label="Experience" value={`${tutorProfile.yearsExperience} years`} />
                  <Row label="Courses" value={tutorProfile.courseCodes?.join(", ")} />
                  <Row label="Badges" value={tutorProfile.verifiedTypes?.join(", ") || "None"} />
                </dl>
                <Link
                  href={`/tutors/${tutorProfile.slug}`}
                  className="inline-block text-sm font-semibold text-brand-600 hover:underline"
                >
                  View public profile →
                </Link>
              </CardBody>
            </Card>
          )}

          {students.length > 0 && (
            <Card>
              <CardHeader title="Learners" description={`${students.length} on this account`} />
              <CardBody>
                <ul className="space-y-3">
                  {students.map((student) => (
                    <li key={student.id} className="flex items-center gap-3">
                      <Avatar
                        firstName={student.firstName}
                        lastName={student.lastName}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ink-900">
                          {student.firstName} {student.lastName}
                        </p>
                        <p className="text-xs text-ink-500">
                          {student.gradeName ?? "Grade not set"}
                          {student.archivedAt ? " · archived" : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Audit trail"
              description="Security-relevant actions on this account."
            />
            <CardBody>
              {audit.length === 0 ? (
                <p className="text-sm text-ink-500">No recorded actions.</p>
              ) : (
                <ul className="space-y-3">
                  {audit.map((log) => (
                    <li key={log.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-ink-300" />
                      <div className="min-w-0">
                        <p className="font-medium text-ink-800">
                          {log.action.replace(/_/g, " ").toLowerCase()}
                        </p>
                        <p className="text-xs text-ink-500">
                          {log.actorId
                            ? `by ${log.actorId.firstName} ${log.actorId.lastName}`
                            : "system"}{" "}
                          · {formatRelative(log.createdAt)}
                        </p>
                        {log.metadata?.reason && (
                          <p className="mt-1 text-xs italic text-ink-600">
                            “{log.metadata.reason}”
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader title="Account" />
          <CardBody>
            <dl className="space-y-3 text-sm">
              <Row icon={<Mail className="size-3.5" />} label="Email" value={user.email} />
              <Row icon={<Phone className="size-3.5" />} label="Phone" value={user.phone} />
              <Row
                icon={<MapPin className="size-3.5" />}
                label="Location"
                value={[user.city, user.province].filter(Boolean).join(", ")}
              />
              <Row label="Status" value={user.status.replace(/_/g, " ").toLowerCase()} />
              <Row
                label="Email verified"
                value={user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : "No"}
              />
              <Row
                icon={<Clock className="size-3.5" />}
                label="Last sign-in"
                value={user.lastLoginAt ? formatRelative(user.lastLoginAt) : "Never"}
              />
              <Row label="Timezone" value={user.timeZone} />
              {user.oauthAccounts?.length > 0 && (
                <Row
                  label="Linked accounts"
                  value={user.oauthAccounts.map((a) => a.provider).join(", ")}
                />
              )}
            </dl>
          </CardBody>
        </Card>
      </div>
    </DashboardPage>
  );
}

function Row({ icon, label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 break-words font-medium text-ink-800">{value}</dd>
    </div>
  );
}
