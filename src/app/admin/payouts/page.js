import Link from "next/link";
import { Banknote, Clock } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PAYOUT_STATUS, PAYOUT_STATUS_LABELS } from "@/constants";
import { listPayouts, pendingPayoutSummary } from "@/services/payout.service";
import { getSettings } from "@/services/settings.service";
import {
  Alert, Badge, Card, CardBody, CardHeader, EmptyState, Pagination, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { CreatePayoutButton, UpdatePayoutButton } from "@/components/admin/PayoutActions";
import { formatMoney, formatDate, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

function tone(status) {
  if (status === PAYOUT_STATUS.PAID) return "success";
  if (status === PAYOUT_STATUS.FAILED) return "danger";
  if (status === PAYOUT_STATUS.IN_TRANSIT) return "brand";
  return "warning";
}

export default async function AdminPayoutsPage({ searchParams }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/payouts");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const [{ items, total, pageSize }, pending, settings] = await Promise.all([
    listPayouts(user, { page: Number(page) }),
    pendingPayoutSummary(),
    getSettings(),
  ]);

  const owed = pending.reduce((sum, p) => sum + p.amountCents, 0);
  const blocked = pending.filter((p) => !p.payoutsEnabled);

  return (
    <DashboardPage>
      <PageHeader
        title="Payouts"
        description={`Earnings become payable ${settings.payoutHoldDays} days after a lesson is completed.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Owed to tutors"
          value={formatMoney(owed, { compact: true })}
          hint={`${pending.length} tutors`}
          icon={<Banknote className="size-5" />}
        />
        <StatCard label="Payouts created" value={total} />
        <StatCard
          label="Blocked on setup"
          value={blocked.length}
          hint={blocked.length > 0 ? "Tutors haven't connected an account" : "None"}
          icon={<Clock className="size-5" />}
        />
      </div>

      {blocked.length > 0 && (
        <Alert tone="warning" title={`${blocked.length} tutors can't be paid yet`} className="mt-6">
          They have earnings ready but haven&rsquo;t finished payout setup:{" "}
          {blocked.map((b) => `${b.tutor?.firstName} ${b.tutor?.lastName}`).join(", ")}.
        </Alert>
      )}

      <Card className="mt-6">
        <CardHeader
          title="Ready to pay"
          description="Completed lessons past their hold period, not yet attached to a payout."
        />
        <CardBody className="p-0">
          {pending.length === 0 ? (
            <EmptyState
              compact
              className="m-5 border-0 bg-transparent"
              icon={<Banknote className="size-6" />}
              title="Nothing to pay right now"
              description="Everything eligible has already been paid out."
            />
          ) : (
            <Table className="min-w-[640px]">
              <THead>
                <TH>Tutor</TH>
                <TH align="center">Lessons</TH>
                <TH>Oldest lesson</TH>
                <TH>Payout account</TH>
                <TH align="right">Amount</TH>
                <TH align="right">Action</TH>
              </THead>
              <TBody>
                {pending.map((row) => (
                  <TR key={row.tutorUserId}>
                    <TD>
                      <Link
                        href={`/admin/users/${row.tutorUserId}`}
                        className="font-semibold text-brand-600 hover:underline"
                      >
                        {row.tutor?.firstName} {row.tutor?.lastName}
                      </Link>
                      <span className="block text-xs text-ink-500">{row.tutor?.email}</span>
                    </TD>
                    <TD align="center">{row.lessonCount}</TD>
                    <TD className="text-xs">
                      {row.oldestCompletedAt ? formatRelative(row.oldestCompletedAt) : "—"}
                    </TD>
                    <TD>
                      <Badge tone={row.payoutsEnabled ? "success" : "warning"} size="sm">
                        {row.payoutsEnabled ? "Ready" : "Not set up"}
                      </Badge>
                    </TD>
                    <TD align="right">
                      <span className="font-bold text-ink-900">
                        {formatMoney(row.amountCents)}
                      </span>
                    </TD>
                    <TD align="right">
                      <CreatePayoutButton tutor={row} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Payout history" />
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              compact
              className="m-5 border-0 bg-transparent"
              title="No payouts created yet"
            />
          ) : (
            <Table className="min-w-[720px]">
              <THead>
                <TH>Reference</TH>
                <TH>Tutor</TH>
                <TH align="center">Lessons</TH>
                <TH>Status</TH>
                <TH align="right">Amount</TH>
                <TH align="right">Action</TH>
              </THead>
              <TBody>
                {items.map((payout) => (
                  <TR key={payout.id}>
                    <TD>
                      <span className="font-semibold text-ink-900">{payout.reference}</span>
                      <span className="block text-xs text-ink-500">
                        {formatDate(payout.createdAt)}
                      </span>
                    </TD>
                    <TD className="text-sm">
                      {payout.tutorUserId?.firstName} {payout.tutorUserId?.lastName}
                    </TD>
                    <TD align="center">{payout.lessonCount}</TD>
                    <TD>
                      <Badge tone={tone(payout.status)} size="sm">
                        {PAYOUT_STATUS_LABELS[payout.status]}
                      </Badge>
                      {payout.failureReason && (
                        <span className="mt-1 block text-xs text-danger-600">
                          {payout.failureReason}
                        </span>
                      )}
                    </TD>
                    <TD align="right">
                      <span className="font-bold text-ink-900">
                        {formatMoney(payout.amountCents)}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {formatMoney(payout.commissionCents)} fee
                      </span>
                    </TD>
                    <TD align="right">
                      <UpdatePayoutButton payout={payout} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="payouts"
        buildHref={(p) => `/admin/payouts?page=${p}`}
      />
    </DashboardPage>
  );
}
