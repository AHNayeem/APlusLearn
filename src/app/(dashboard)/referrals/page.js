import { connectToDatabase } from "@/lib/db/connect";
import { enforceAuth } from "@/lib/auth/guards";
import { referralSummary } from "@/services/referral.service";
import { creditBalance } from "@/services/credit.service";
import { envBaseUrl } from "@/lib/config/base-url";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ReferralPanel } from "@/components/referrals/ReferralPanel";

export const metadata = { title: "Invite a friend" };
export const dynamic = "force-dynamic";

/** Referrals and account credit (§41 Phase 2). Open to every signed-in role. */
export default async function ReferralsPage() {
  const user = await enforceAuth("/referrals");
  await connectToDatabase();

  const [summary, balanceCents] = await Promise.all([
    referralSummary(user),
    creditBalance(user.id),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Invite a friend"
        description="Share your code with anyone looking for a tutor."
      />

      <div className="max-w-2xl">
        <ReferralPanel
          summary={summary}
          creditBalanceCents={balanceCents}
          shareUrl={`${envBaseUrl()}/register?ref=${summary.code}`}
        />
      </div>
    </DashboardPage>
  );
}
