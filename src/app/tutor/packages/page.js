import { Package } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, PACKAGE_PURCHASE_STATUS, PACKAGE_PURCHASE_STATUS_LABELS } from "@/constants";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import { listPackagesForTutor, listPurchasesForTutor } from "@/services/package.service";
import { getSettings } from "@/services/settings.service";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { PackageManager } from "@/components/packages/PackageManager";
import { learnerDisplayName, formatMoney, formatDate } from "@/lib/utils/format";

export const metadata = { title: "Packages" };
export const dynamic = "force-dynamic";

/** A tutor's package offers, and who is holding lessons (§41 Phase 2). */
export default async function TutorPackagesPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/packages");
  await connectToDatabase();

  const profile = await getTutorProfileByUserId(user.id);
  if (!profile) {
    return (
      <DashboardPage>
        <PageHeader title="Packages" />
        <EmptyState
          title="Finish your application first"
          description="Packages open once your profile has been submitted."
          action={<Button href="/tutor/onboarding">Continue application</Button>}
        />
      </DashboardPage>
    );
  }

  const [{ packages }, purchases, settings] = await Promise.all([
    listPackagesForTutor(user, {}),
    listPurchasesForTutor(user, {}),
    getSettings(),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Packages"
        description="Sell a block of lessons up front. Families book them whenever suits."
      />

      {settings.packages?.enabled === false && (
        <Alert tone="warning" title="Packages are switched off platform-wide" className="mb-6">
          Existing balances still work, but nobody can buy a new package right now.
        </Alert>
      )}

      <div className="max-w-3xl space-y-6">
        <PackageManager
          initial={packages}
          courses={profile.courses ?? []}
          standardRateCents={profile.hourlyRateCents}
        />

        <Card>
          <CardHeader
            title="Lessons families are holding"
            description="Balances bought from you. Each one is a booking waiting to happen."
          />
          <CardBody className="p-0">
            {purchases.items.length === 0 ? (
              <EmptyState
                icon={<Package className="size-7" />}
                title="Nothing sold yet"
                description="Once a family buys a package it shows up here with the lessons they have left."
              />
            ) : (
              <Table>
                <THead>
                  <TH>Student</TH>
                  <TH>Package</TH>
                  <TH>Left</TH>
                  <TH>Expires</TH>
                  <TH>Status</TH>
                </THead>
                <TBody>
                  {purchases.items.map((purchase) => (
                    <TR key={purchase.id}>
                      <TD className="text-xs">
                        {learnerDisplayName(purchase.studentProfileId)}
                      </TD>
                      <TD className="text-xs">
                        {purchase.title}
                        <span className="block text-ink-400">
                          {formatMoney(purchase.priceCents)}
                        </span>
                      </TD>
                      <TD className="text-xs font-semibold">
                        {purchase.sessionsTotal - purchase.sessionsUsed} of{" "}
                        {purchase.sessionsTotal}
                      </TD>
                      <TD className="text-xs">
                        {purchase.expiresAt ? formatDate(purchase.expiresAt) : "—"}
                      </TD>
                      <TD>
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
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>
    </DashboardPage>
  );
}
