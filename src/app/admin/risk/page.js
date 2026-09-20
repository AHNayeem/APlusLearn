import Link from "next/link";
import { ShieldAlert, ShieldCheck, Eye, Flame } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES,
  RISK_CASE_STATUS,
  RISK_CASE_STATUS_LABELS,
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  RISK_SIGNAL_LABELS,
  RISK_ACTION_LABELS,
} from "@/constants";
import { listRiskCases, riskOverview } from "@/services/risk.service";
import { getSettings } from "@/services/settings.service";
import {
  Alert, Badge, Card, CardBody, EmptyState, LinkTabs, Pagination, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RiskCaseActions } from "@/components/admin/RiskCaseActions";
import { formatDate, formatNumber, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Risk" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: RISK_CASE_STATUS.OPEN, label: "Needs review" },
  { value: RISK_CASE_STATUS.UNDER_REVIEW, label: "Being reviewed" },
  { value: RISK_CASE_STATUS.CONFIRMED, label: "Confirmed" },
  { value: RISK_CASE_STATUS.CLEARED, label: "Cleared" },
];

function statusTone(status) {
  if (status === RISK_CASE_STATUS.OPEN) return "warning";
  if (status === RISK_CASE_STATUS.UNDER_REVIEW) return "brand";
  if (status === RISK_CASE_STATUS.CONFIRMED) return "danger";
  return "success";
}

function levelTone(level) {
  if (level === RISK_LEVELS.HIGH) return "danger";
  if (level === RISK_LEVELS.MEDIUM) return "warning";
  return "neutral";
}

/**
 * Fraud and risk review (§41 Phase 2).
 *
 * A case is an explanation, not a verdict: it shows which signals fired, when,
 * and what evidence sits behind each one, so an administrator decides on the
 * facts rather than on a score. Nothing on this page restricts an account —
 * that is still done from Users, deliberately, and recorded here.
 */
export default async function AdminRiskPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/risk");
  await connectToDatabase();

  const { status = "", level = "", page = "1" } = await searchParams;

  const [{ items, total, pageSize }, overview, settings] = await Promise.all([
    listRiskCases({
      status: status || undefined,
      level: level || undefined,
      page: Number(page),
    }),
    riskOverview(),
    getSettings(),
  ]);

  const risk = settings.risk ?? {};

  return (
    <DashboardPage>
      <PageHeader
        title="Risk"
        description="Accounts the platform has flagged, why, and what was decided."
      />

      {risk.enabled === false ? (
        <Alert tone="warning" className="mb-6">
          Risk detection is switched off in platform settings. No new signals are being recorded.
          Existing cases are unchanged.
        </Alert>
      ) : (
        <Alert tone="info" className="mb-6">
          A case opens when {risk.reviewScore} different kinds of signal fire for one account inside{" "}
          {risk.signalWindowDays} days, and is called high risk at {risk.highScore}. Nothing is ever
          restricted automatically — a case is a prompt for a person, not a penalty.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Needs review"
          value={formatNumber(overview.open)}
          icon={<ShieldAlert className="size-5" />}
          href="/admin/risk?status=OPEN"
        />
        <StatCard
          label="Being reviewed"
          value={formatNumber(overview.underReview)}
          icon={<Eye className="size-5" />}
        />
        <StatCard
          label="High risk, unresolved"
          value={formatNumber(overview.high)}
          icon={<Flame className="size-5" />}
          href="/admin/risk?level=HIGH"
        />
        <StatCard
          label="Confirmed to date"
          value={formatNumber(overview.confirmed)}
          icon={<ShieldCheck className="size-5" />}
        />
      </div>

      <LinkTabs
        className="mt-6"
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/risk?status=${tab.value}` : "/admin/risk",
        }))}
      />

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-7" />}
              title="Nothing flagged"
              description="No account matches this filter. That is the result you want."
            />
          ) : (
            <Table className="min-w-[860px]">
              <THead>
                <TH>Account</TH>
                <TH>Signals</TH>
                <TH>Level</TH>
                <TH>Status</TH>
                <TH>Last signal</TH>
                <TH align="right">Review</TH>
              </THead>
              <TBody>
                {items.map((riskCase) => (
                  <TR key={riskCase.id}>
                    <TD className="text-xs">
                      <span className="font-semibold text-ink-900">
                        {riskCase.subjectUserId?.firstName} {riskCase.subjectUserId?.lastName}
                      </span>
                      <span className="block text-ink-400">
                        {riskCase.subjectUserId?.email} · {riskCase.reference}
                      </span>
                      {riskCase.subjectUserId?.id && (
                        <Link
                          href={`/admin/users/${riskCase.subjectUserId.id}`}
                          className="mt-0.5 inline-block text-[11px] font-semibold text-brand-700 hover:underline"
                        >
                          Open account
                        </Link>
                      )}
                    </TD>

                    <TD className="text-xs">
                      <ul className="space-y-1">
                        {riskCase.signals?.map((signal) => (
                          <li key={signal.id ?? signal.dedupeKey}>
                            <span className="font-medium text-ink-800">
                              {RISK_SIGNAL_LABELS[signal.type] ?? signal.type}
                            </span>
                            {signal.summary && (
                              <span className="block text-[11px] text-ink-500">
                                {signal.summary}
                              </span>
                            )}
                            <span className="block text-[11px] text-ink-400">
                              {formatDate(signal.detectedAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </TD>

                    <TD>
                      <Badge tone={levelTone(riskCase.level)} size="sm">
                        {RISK_LEVEL_LABELS[riskCase.level]}
                      </Badge>
                      <span className="mt-1 block text-[11px] text-ink-400">
                        {riskCase.score} {riskCase.score === 1 ? "signal" : "signals"}
                      </span>
                    </TD>

                    <TD>
                      <Badge tone={statusTone(riskCase.status)} size="sm">
                        {RISK_CASE_STATUS_LABELS[riskCase.status]}
                      </Badge>
                      {riskCase.actions?.length > 0 && (
                        <span className="mt-1 block text-[11px] text-ink-500">
                          {RISK_ACTION_LABELS[riskCase.actions.at(-1).action]}
                        </span>
                      )}
                      {riskCase.resolutionNote && (
                        <span className="mt-0.5 block text-[11px] text-ink-400">
                          {riskCase.resolutionNote}
                        </span>
                      )}
                    </TD>

                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatRelative(riskCase.lastSignalAt)}
                    </TD>

                    <TD align="right">
                      <RiskCaseActions riskCase={riskCase} />
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
        label="cases"
        buildHref={(p) => `/admin/risk?status=${status}&level=${level}&page=${p}`}
      />
    </DashboardPage>
  );
}
