import { Megaphone } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PROMOTION_STATUS, PROMOTION_STATUS_LABELS } from "@/constants";
import { listPromotions, listPromotableTutors } from "@/services/promotion.service";
import { getSettings } from "@/services/settings.service";
import {
  Alert, Badge, Card, CardBody, EmptyState, LinkTabs, Pagination,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { PromotionActions } from "@/components/admin/PromotionActions";
import { PromotionCreateForm } from "@/components/admin/PromotionCreateForm";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "Promoted profiles" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: PROMOTION_STATUS.ACTIVE, label: "Running" },
  { value: PROMOTION_STATUS.SCHEDULED, label: "Scheduled" },
  { value: PROMOTION_STATUS.PAUSED, label: "Paused" },
  { value: PROMOTION_STATUS.EXPIRED, label: "Finished" },
  { value: PROMOTION_STATUS.CANCELLED, label: "Cancelled" },
];

function tone(status) {
  if (status === PROMOTION_STATUS.ACTIVE) return "success";
  if (status === PROMOTION_STATUS.SCHEDULED) return "brand";
  if (status === PROMOTION_STATUS.PAUSED) return "warning";
  if (status === PROMOTION_STATUS.CANCELLED) return "danger";
  return "neutral";
}

/**
 * Promoted tutor profiles (§41 Phase 2).
 *
 * The register of who is being featured, when, and on whose authority. A
 * promotion changes where an eligible tutor sits in the default ordering and
 * nothing else — it cannot make an unapproved profile visible, and it stands
 * down whenever a visitor has chosen their own sort order.
 */
export default async function AdminPromotionsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/promotions");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;

  const [{ items, total, pageSize }, tutors, settings] = await Promise.all([
    listPromotions({ status: status || undefined, page: Number(page) }),
    listPromotableTutors(),
    getSettings(),
  ]);

  const live = items.filter((p) => p.isLive).length;
  const promotions = settings.promotions ?? {};

  return (
    <DashboardPage>
      <PageHeader
        title="Promoted profiles"
        description="Featured placements in the default search ordering, and who granted them."
        action={
          <PromotionCreateForm
            tutors={tutors}
            defaultDurationDays={promotions.defaultDurationDays}
          />
        }
      />

      {promotions.enabled === false ? (
        <Alert tone="warning" className="mt-2">
          Promoted profiles are switched off in platform settings. Existing promotions are not
          affecting search, and new ones cannot be created.
        </Alert>
      ) : (
        <Alert tone="info" className="mt-2">
          At most {promotions.maxPromotedPerSearch} promoted tutors are lifted in any one set of
          results, and only when the visitor has not chosen their own sort order. Every promoted
          result is labelled. A promotion never changes who is eligible to appear.
        </Alert>
      )}

      <LinkTabs
        className="mt-6"
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/promotions?status=${tab.value}` : "/admin/promotions",
        }))}
      />

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<Megaphone className="size-7" />}
              title="No promotions"
              description="Nothing matches this filter."
            />
          ) : (
            <Table>
              <THead>
                <TH>Tutor</TH>
                <TH>Window</TH>
                <TH>Status</TH>
                <TH>Granted by</TH>
                <TH align="right">Actions</TH>
              </THead>
              <TBody>
                {items.map((promotion) => (
                  <TR key={promotion.id}>
                    <TD className="text-xs">
                      <span className="font-semibold text-ink-900">
                        {promotion.tutorUserId?.firstName} {promotion.tutorUserId?.lastName}
                      </span>
                      <span className="block text-ink-400">
                        {promotion.tutorProfileId?.city ?? "—"}
                        {promotion.tutorProfileId?.isSearchable === false && " · not searchable"}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatDate(promotion.startsAt)}
                      <span className="block text-ink-400">to {formatDate(promotion.endsAt)}</span>
                    </TD>
                    <TD>
                      <Badge tone={tone(promotion.status)} size="sm">
                        {PROMOTION_STATUS_LABELS[promotion.status]}
                      </Badge>
                      {promotion.isLive && (
                        <span className="mt-1 block text-[11px] text-success-600">
                          Affecting search now
                        </span>
                      )}
                    </TD>
                    <TD className="text-xs text-ink-500">
                      {promotion.createdBy?.firstName} {promotion.createdBy?.lastName}
                      {promotion.note && (
                        <span className="mt-0.5 block text-[11px] text-ink-400">
                          {promotion.note}
                        </span>
                      )}
                    </TD>
                    <TD align="right">
                      <PromotionActions promotion={promotion} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {items.length > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          {live} of these {live === 1 ? "is" : "are"} affecting search right now.
        </p>
      )}

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="promotions"
        buildHref={(p) => `/admin/promotions?status=${status}&page=${p}`}
      />
    </DashboardPage>
  );
}
