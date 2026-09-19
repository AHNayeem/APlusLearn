import { Package } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, PACKAGE_PURCHASE_STATUS, PACKAGE_PURCHASE_STATUS_LABELS,
} from "@/constants";
import { listAllPurchases } from "@/services/package.service";
import {
  Badge, Card, CardBody, EmptyState, LinkTabs, Pagination, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Packages" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: PACKAGE_PURCHASE_STATUS.ACTIVE, label: "Active" },
  { value: PACKAGE_PURCHASE_STATUS.COMPLETED, label: "Used up" },
  { value: PACKAGE_PURCHASE_STATUS.EXPIRED, label: "Expired" },
  { value: PACKAGE_PURCHASE_STATUS.REFUNDED, label: "Refunded" },
];

function tone(status) {
  if (status === PACKAGE_PURCHASE_STATUS.ACTIVE) return "success";
  if (status === PACKAGE_PURCHASE_STATUS.REFUNDED) return "danger";
  if (status === PACKAGE_PURCHASE_STATUS.EXPIRED) return "warning";
  return "neutral";
}

/** Package purchases, for support and reconciliation (§41 Phase 2). */
export default async function AdminPackagesPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/packages");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const { items, total, pageSize, totals } = await listAllPurchases({
    status: status || undefined,
    page: Number(page),
  });

  const outstanding = Math.max(0, totals.sessionsSold - totals.sessionsUsed);

  return (
    <DashboardPage>
      <PageHeader
        title="Packages"
        description="Blocks of lessons families have bought, and how much of each is still owed."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Gross sold" value={formatMoney(totals.grossCents)} />
        <StatCard label="Refunded" value={formatMoney(totals.refundedCents)} />
        <StatCard label="Lessons sold" value={totals.sessionsSold} />
        <StatCard
          label="Lessons still owed"
          value={outstanding}
          hint="Paid for but not yet taught"
        />
      </div>

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/packages?status=${tab.value}` : "/admin/packages",
        }))}
      />

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<Package className="size-7" />}
              title="Nothing here"
              description="No package purchases match this filter."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Bought</TH>
                  <TH>Family</TH>
                  <TH>Tutor</TH>
                  <TH>Package</TH>
                  <TH>Used</TH>
                  <TH>Value</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((purchase) => (
                  <TR key={purchase.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatRelative(purchase.createdAt)}
                    </TD>
                    <TD className="text-xs">
                      {purchase.purchaserId?.firstName} {purchase.purchaserId?.lastName}
                      <span className="block text-ink-400">{purchase.purchaserId?.email}</span>
                    </TD>
                    <TD className="text-xs">
                      {purchase.tutorUserId?.firstName} {purchase.tutorUserId?.lastName}
                    </TD>
                    <TD className="text-xs">
                      {purchase.title}
                      <span className="block text-ink-400">{purchase.reference}</span>
                    </TD>
                    <TD className="whitespace-nowrap text-xs font-semibold">
                      {purchase.sessionsUsed} / {purchase.sessionsTotal}
                    </TD>
                    <TD className="whitespace-nowrap text-xs">
                      {formatMoney(purchase.priceCents)}
                      {purchase.refundedCents > 0 && (
                        <span className="block text-danger-600">
                          −{formatMoney(purchase.refundedCents)}
                        </span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={tone(purchase.status)} size="sm">
                        {PACKAGE_PURCHASE_STATUS_LABELS[purchase.status]}
                      </Badge>
                      {purchase.expiresAt && (
                        <span className="mt-1 block text-[11px] text-ink-400">
                          {formatDate(purchase.expiresAt)}
                        </span>
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
        label="purchases"
        buildHref={(p) => `/admin/packages?status=${status}&page=${p}`}
      />
    </DashboardPage>
  );
}
