import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail, Phone, MapPin, Clock } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, ROLE_LABELS, USER_STATUS_LABELS, BLOCKED_USER_STATUSES, TUTOR_STATUS_LABELS,
  BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS, REPORT_STATUS_LABELS, AUDIT_ACTIONS,
} from "@/constants";
import { getUserDetail } from "@/services/user.service";
import { listAuditLogs } from "@/services/audit.service";
import { adminUserDetailQuerySchema } from "@/lib/validation/admin-users";
import {
  Alert, Avatar, Badge, Card, CardBody, CardHeader, EmptyState, Pagination, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { UserActions } from "@/components/admin/UserActions";
import { formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "User details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Plain-language names for the account events this page lists (S15). */
const AUDIT_LABELS = {
  [AUDIT_ACTIONS.USER_SUSPENDED]: "Suspended",
  [AUDIT_ACTIONS.USER_BANNED]: "Banned",
  [AUDIT_ACTIONS.USER_REINSTATED]: "Restored",
  [AUDIT_ACTIONS.USER_DELETED]: "Deleted and anonymised",
  [AUDIT_ACTIONS.USER_EMAIL_VERIFIED_BY_ADMIN]: "Email marked verified by an administrator",
  [AUDIT_ACTIONS.USER_SESSIONS_REVOKED]: "Signed out everywhere by an administrator",
  [AUDIT_ACTIONS.USER_LOGIN]: "Signed in",
  [AUDIT_ACTIONS.USER_REGISTERED]: "Registered",
  [AUDIT_ACTIONS.USER_PASSWORD_RESET]: "Password reset",
  [AUDIT_ACTIONS.USER_DEVICE_TRUSTED]: "New browser trusted",
};

function auditLabel(action) {
  return AUDIT_LABELS[action] ?? action.replace(/_/g, " ").toLowerCase();
}

function personName(person) {
  if (!person) return "—";
  return `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() || "—";
}

/**
 * One account and what it has done here (R28.3): lessons, payments and
 * conversations, each paged on its own, plus its audit trail. Conversations
 * show who and when — never what was said; a thread is read only through the
 * audited moderation queue once somebody reports it (S8).
 */
export default async function AdminUserDetailPage({ params, searchParams }) {
  const { id } = await params;
  const admin = await enforceRole(ROLES.ADMIN, `/admin/users/${id}`);
  await connectToDatabase();

  const raw = await searchParams;
  const parsed = adminUserDetailQuerySchema.safeParse(raw ?? {});
  const pages = parsed.success ? parsed.data : adminUserDetailQuerySchema.parse({});

  const detail = await getUserDetail(id, pages).catch(() => null);
  if (!detail) notFound();

  const { user, tutorProfile, students, bookingCount, lifetimeSpendCents, history } = detail;
  const audit = await listAuditLogs({ entityType: "User", entityId: id, limit: 20 });
  const blocked = BLOCKED_USER_STATUSES.includes(user.status);

  const hrefFor = (key) => (page) => {
    const next = new URLSearchParams();
    for (const [name, value] of Object.entries({ ...pages, [key]: page })) {
      if (value > 1) next.set(name, String(value));
    }
    const query = next.toString();
    return `/admin/users/${id}${query ? `?${query}` : ""}`;
  };

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
        action={<UserActions user={user} isSelf={String(admin.id) === String(user.id)} />}
      />

      {blocked && (
        <Alert
          tone="danger"
          className="mb-6"
          title={`${USER_STATUS_LABELS[user.status]}${user.statusChangedAt ? ` ${formatRelative(user.statusChangedAt)}` : ""}`}
        >
          {user.statusReason ?? "No reason was recorded."}
        </Alert>
      )}

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

          <HistoryCard
            title="Lessons"
            description="As the purchaser or as the tutor, newest first."
            data={history.bookings}
            buildHref={hrefFor("bookingsPage")}
            empty="No lessons booked."
          >
            <Table className="min-w-[640px]">
              <THead>
                <TH>Lesson</TH>
                <TH>When</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH align="right">Price</TH>
              </THead>
              <TBody>
                {history.bookings.items.map((booking) => {
                  const asTutor = String(booking.tutorUserId?.id ?? booking.tutorUserId) === String(user.id);
                  return (
                    <TR key={booking.id}>
                      <TD>
                        <span className="block font-semibold text-ink-900">
                          {booking.courseCode ?? booking.courseName}
                        </span>
                        <span className="block text-xs text-ink-500">{booking.reference}</span>
                      </TD>
                      <TD className="text-xs">{formatDateTime(booking.startAt)}</TD>
                      <TD className="text-xs">
                        {asTutor
                          ? `Tutor · with ${personName(booking.studentProfileId)}`
                          : `Booked with ${personName(booking.tutorUserId)}`}
                      </TD>
                      <TD>
                        <Badge tone="neutral" size="sm">
                          {BOOKING_STATUS_LABELS[booking.status] ?? booking.status}
                        </Badge>
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {formatMoney(booking.price?.totalCents ?? 0)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </HistoryCard>

          <HistoryCard
            title="Payments"
            description="Paid by or to this account. Lifetime spend is settled charges less refunds."
            data={history.payments}
            buildHref={hrefFor("paymentsPage")}
            empty="No payments."
          >
            <Table className="min-w-[640px]">
              <THead>
                <TH>Payment</TH>
                <TH>Direction</TH>
                <TH>Status</TH>
                <TH align="right">Charged</TH>
                <TH align="right">Refunded</TH>
              </THead>
              <TBody>
                {history.payments.items.map((payment) => {
                  const asPayer = String(payment.purchaserId) === String(user.id);
                  return (
                    <TR key={payment.id}>
                      <TD>
                        <span className="block font-semibold text-ink-900">
                          {payment.receiptNumber ?? payment.id.slice(-8)}
                        </span>
                        <span className="block text-xs text-ink-500">
                          {payment.paidAt ? `Paid ${formatDate(payment.paidAt)}` : `Started ${formatDate(payment.createdAt)}`}
                          {payment.packagePurchaseId ? " · package" : ""}
                        </span>
                      </TD>
                      <TD className="text-xs">{asPayer ? "Paid by this account" : "Paid to this tutor"}</TD>
                      <TD>
                        <Badge tone="neutral" size="sm">
                          {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                        </Badge>
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {formatMoney(payment.totalCents ?? 0)}
                      </TD>
                      <TD align="right" className="tabular-nums">
                        {payment.refundedCents ? formatMoney(payment.refundedCents) : "—"}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </HistoryCard>

          <HistoryCard
            title="Conversations"
            description="Who and when only. A thread is read through the moderation queue once it is reported."
            data={history.conversations}
            buildHref={hrefFor("conversationsPage")}
            empty="No conversations."
          >
            <Table className="min-w-[560px]">
              <THead>
                <TH>With</TH>
                <TH>Started</TH>
                <TH>Last activity</TH>
                <TH>Report</TH>
              </THead>
              <TBody>
                {history.conversations.items.map((conversation) => {
                  const other =
                    String(conversation.learner?.id) === String(user.id)
                      ? conversation.tutor
                      : conversation.learner;
                  return (
                    <TR key={conversation.id}>
                      <TD>
                        {other?.id ? (
                          <Link
                            href={`/admin/users/${other.id}`}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            {personName(other)}
                          </Link>
                        ) : (
                          personName(other)
                        )}
                        {conversation.blocked && (
                          <span className="block text-xs text-warning-700">Blocked</span>
                        )}
                      </TD>
                      <TD className="text-xs">{formatDate(conversation.createdAt)}</TD>
                      <TD className="text-xs">
                        {conversation.lastMessageAt ? formatRelative(conversation.lastMessageAt) : "—"}
                      </TD>
                      <TD>
                        {conversation.reportStatus ? (
                          <Link
                            href={`/admin/moderation/${conversation.id}`}
                            className="text-xs font-semibold text-brand-700 hover:underline"
                          >
                            {REPORT_STATUS_LABELS[conversation.reportStatus] ?? conversation.reportStatus}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-400">—</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </HistoryCard>

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
                        <p className="font-medium text-ink-800">{auditLabel(log.action)}</p>
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
              <Row label="Status" value={USER_STATUS_LABELS[user.status] ?? user.status} />
              {user.statusReason && <Row label="Status reason" value={user.statusReason} />}
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

/** One paged history panel. */
function HistoryCard({ title, description, data, buildHref, empty, children }) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardBody className="space-y-4">
        {data.items.length === 0 ? (
          <EmptyState compact className="border-0 bg-transparent" title={empty} />
        ) : (
          children
        )}
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          pageSize={data.pageSize}
          total={data.total}
          buildHref={buildHref}
        />
      </CardBody>
    </Card>
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
