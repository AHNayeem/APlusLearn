import { Banknote } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PAYOUT_STATUS, PAYOUT_STATUS_LABELS } from "@/constants";
import { listPayouts, getPayoutAccount } from "@/services/payout.service";
import { tutorEarnings } from "@/services/payment.service";
import { getSettings } from "@/services/settings.service";
import { paymentProviderStatus } from "@/services/external/payment-provider";
import {
  Badge, Card, CardBody, CardHeader, EmptyState, StatCard, Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { PayoutOnboarding } from "@/components/tutor/PayoutOnboarding";
import { formatMoney, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Payouts" };
export const dynamic = "force-dynamic";

function statusTone(status) {
  if (status === PAYOUT_STATUS.PAID) return "success";
  if (status === PAYOUT_STATUS.FAILED) return "danger";
  if (status === PAYOUT_STATUS.IN_TRANSIT) return "brand";
  return "warning";
}

export default async function TutorPayoutsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/payouts");
  await connectToDatabase();

  const [account, { items }, earnings, settings, payments] = await Promise.all([
    getPayoutAccount(user.id),
    listPayouts(user, { pageSize: 25 }),
    tutorEarnings(user.id, { days: 365 }),
    getSettings(),
    paymentProviderStatus(),
  ]);

  const paidTotal = items
    .filter((p) => p.status === PAYOUT_STATUS.PAID)
    .reduce((sum, p) => sum + p.amountCents, 0);

  return (
    <DashboardPage>
      <PageHeader
        title="Payouts"
        description={`Earnings become payable ${settings.payoutHoldDays} days after a lesson is completed.`}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Ready for payout"
          value={formatMoney(earnings.pendingPayoutCents, { compact: true })}
          icon={<Banknote className="size-5" />}
        />
        <StatCard label="Paid out to date" value={formatMoney(paidTotal, { compact: true })} />
        <StatCard label="Payouts" value={items.length} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="lg:order-1">
          <CardHeader title="Payout history" />
          <CardBody className="p-0">
            {items.length === 0 ? (
              <EmptyState
                compact
                className="m-5 border-0 bg-transparent"
                icon={<Banknote className="size-6" />}
                title="No payouts yet"
                description="Once you've taught lessons and cleared the hold period, payouts appear here."
              />
            ) : (
              <Table className="min-w-[560px]">
                <THead>
                  <TH>Reference</TH>
                  <TH>Period</TH>
                  <TH align="center">Lessons</TH>
                  <TH>Status</TH>
                  <TH align="right">Amount</TH>
                </THead>
                <TBody>
                  {items.map((payout) => (
                    <TR key={payout.id}>
                      <TD>
                        <span className="font-semibold text-ink-900">{payout.reference}</span>
                        {payout.paidAt && (
                          <span className="block text-xs text-ink-500">
                            Paid {formatDate(payout.paidAt)}
                          </span>
                        )}
                      </TD>
                      <TD className="text-xs">
                        {payout.periodStart && payout.periodEnd
                          ? `${formatDate(payout.periodStart)} – ${formatDate(payout.periodEnd)}`
                          : "—"}
                      </TD>
                      <TD align="center">{payout.lessonCount}</TD>
                      <TD>
                        <Badge tone={statusTone(payout.status)} size="sm">
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
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        <div className="lg:order-2">
          <PayoutOnboarding account={account} mode={payments.mode} />
        </div>
      </div>
    </DashboardPage>
  );
}
