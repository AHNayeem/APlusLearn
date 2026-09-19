import { Gift, TriangleAlert } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, REFERRAL_STATUS, REFERRAL_STATUS_LABELS, REFERRAL_RISK_FLAG_LABELS,
} from "@/constants";
import { listAllReferrals } from "@/services/referral.service";
import { getSettings } from "@/services/settings.service";
import {
  Alert, Badge, Card, CardBody, EmptyState, LinkTabs, Pagination,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ReverseReferralButton } from "@/components/admin/ReverseReferralButton";
import { formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Referrals" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: "flagged", label: "Flagged" },
  { value: REFERRAL_STATUS.PENDING, label: "Pending" },
  { value: REFERRAL_STATUS.REWARDED, label: "Rewarded" },
  { value: REFERRAL_STATUS.REVERSED, label: "Reversed" },
];

function tone(status) {
  if (status === REFERRAL_STATUS.REWARDED) return "success";
  if (status === REFERRAL_STATUS.REVERSED) return "danger";
  return "neutral";
}

/**
 * The referral review queue (§41 Phase 2).
 *
 * Risk flags are shown, not acted on: the requirements define no penalty for
 * a suspicious referral, so the platform surfaces the signal and leaves the
 * judgement — and the one available action, reversal — to a person.
 */
export default async function AdminReferralsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/referrals");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const [{ items, total, pageSize, flaggedCount }, settings] = await Promise.all([
    listAllReferrals({
      status: status && status !== "flagged" ? status : undefined,
      flagged: status === "flagged",
      page: Number(page),
    }),
    getSettings(),
  ]);

  const unpriced =
    (settings.referrals?.referrerRewardCents ?? 0) === 0 &&
    (settings.referrals?.refereeRewardCents ?? 0) === 0;

  return (
    <DashboardPage>
      <PageHeader
        title="Referrals"
        description="Who introduced whom, what was paid, and anything worth a second look."
      />

      {unpriced && (
        <Alert tone="warning" title="No reward is configured" className="mb-6">
          Referrals are being attributed and qualified, but no credit is granted. Set an amount in
          Settings → Referrals to start paying rewards.
        </Alert>
      )}

      {flaggedCount > 0 && (
        <Alert
          tone="warning"
          title={`${flaggedCount} referral${flaggedCount === 1 ? "" : "s"} flagged for review`}
          icon={<TriangleAlert className="size-3" />}
          className="mb-6"
        >
          A flag is a signal, not a verdict — nothing has been withheld automatically. Reverse one
          only if you judge it abusive.
        </Alert>
      )}

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/referrals?status=${tab.value}` : "/admin/referrals",
        }))}
      />

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<Gift className="size-7" />}
              title="Nothing here"
              description="No referrals match this filter."
            />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Referrer</TH>
                <TH>Joined</TH>
                <TH>Reward</TH>
                <TH>Status</TH>
                <TH />
              </THead>
              <TBody>
                {items.map((referral) => (
                  <TR key={referral.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatRelative(referral.createdAt)}
                    </TD>
                    <TD className="text-xs">
                      {referral.referrerUserId?.firstName} {referral.referrerUserId?.lastName}
                      <span className="block text-ink-400">{referral.referrerUserId?.email}</span>
                    </TD>
                    <TD className="text-xs">
                      {referral.refereeUserId?.firstName} {referral.refereeUserId?.lastName}
                      <span className="block text-ink-400">{referral.refereeUserId?.email}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-xs font-semibold">
                      {referral.referrerRewardCents > 0
                        ? formatMoney(referral.referrerRewardCents)
                        : "—"}
                    </TD>
                    <TD>
                      <Badge tone={tone(referral.status)} size="sm">
                        {REFERRAL_STATUS_LABELS[referral.status]}
                      </Badge>
                      {referral.riskFlags?.map((flag) => (
                        <span key={flag} className="mt-1 block text-[11px] text-warning-700">
                          {REFERRAL_RISK_FLAG_LABELS[flag] ?? flag}
                        </span>
                      ))}
                      {referral.reversalReason && (
                        <span className="mt-1 block text-[11px] text-ink-500">
                          {referral.reversalReason}
                        </span>
                      )}
                    </TD>
                    <TD>
                      {referral.status !== REFERRAL_STATUS.REVERSED && (
                        <ReverseReferralButton referral={referral} />
                      )}
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
        label="referrals"
        buildHref={(p) => `/admin/referrals?status=${status}&page=${p}`}
      />
    </DashboardPage>
  );
}
