import Link from "next/link";
import { Package, Clock } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  LEARNER_ROLES, PACKAGE_PURCHASE_STATUS, PACKAGE_PURCHASE_STATUS_LABELS,
} from "@/constants";
import { listPurchases } from "@/services/package.service";
import {
  Avatar, Badge, Button, Card, CardBody, EmptyState, Pagination, Progress,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "My packages" };
export const dynamic = "force-dynamic";

/** A family's package balances (§41 Phase 2). */
export default async function PackagesPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/packages");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize } = await listPurchases(user, { page: Number(page) });

  return (
    <DashboardPage>
      <PageHeader
        title="My packages"
        description="Lessons you've already paid for. Book them whenever suits you."
      />

      <div className="space-y-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<Package className="size-7" />}
            title="No packages yet"
            description="Some tutors sell blocks of lessons up front, which usually works out cheaper than booking one at a time."
            action={
              <Button href="/find-a-tutor" variant="secondary">
                Find a tutor
              </Button>
            }
          />
        ) : (
          items.map((purchase) => {
            // Both derived in the service, against the operator's configured
            // warning window rather than a number chosen here.
            const { sessionsRemaining: remaining, expiringSoon } = purchase;
            const tutor = purchase.tutorProfileId;

            return (
              <Card key={purchase.id} interactive>
                <CardBody>
                  <Link href={`/packages/${purchase.id}`} className="block">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                          src={tutor?.userId?.avatarUrl}
                          name={tutor?.userId?.firstName ?? "Tutor"}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-bold text-ink-900">{purchase.title}</h2>
                            <Badge
                              tone={
                                purchase.status === PACKAGE_PURCHASE_STATUS.ACTIVE
                                  ? "success"
                                  : "neutral"
                              }
                              size="sm"
                            >
                              {PACKAGE_PURCHASE_STATUS_LABELS[purchase.status]}
                            </Badge>
                            {expiringSoon && (
                              <Badge tone="warning" size="sm" icon={<Clock className="size-3" />}>
                                Expires {formatDate(purchase.expiresAt)}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {purchase.courseCode ? `${purchase.courseCode} · ` : ""}
                            {formatDuration(purchase.sessionDurationMinutes)} lessons ·{" "}
                            for {purchase.studentProfileId?.firstName}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-2xl font-bold tabular-nums text-ink-900">{remaining}</p>
                        <p className="text-xs text-ink-500">
                          of {purchase.sessionsTotal} left
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <Progress
                        value={purchase.sessionsUsed}
                        max={purchase.sessionsTotal}
                        label={`${purchase.sessionsUsed} of ${purchase.sessionsTotal} used`}
                      />
                    </div>

                    <p className="mt-3 text-xs text-ink-500">
                      Paid {formatMoney(purchase.priceCents)}
                      {purchase.refundedCents > 0
                        ? ` · ${formatMoney(purchase.refundedCents)} refunded`
                        : ""}
                      {purchase.expiresAt && !expiringSoon
                        ? ` · valid until ${formatDate(purchase.expiresAt)}`
                        : ""}
                    </p>
                  </Link>
                </CardBody>
              </Card>
            );
          })
        )}
      </div>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="packages"
        buildHref={(p) => `/packages?page=${p}`}
      />
    </DashboardPage>
  );
}
