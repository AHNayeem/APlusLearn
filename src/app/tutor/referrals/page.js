import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { referralSummary } from "@/services/referral.service";
import { creditBalance } from "@/services/credit.service";
import { envBaseUrl } from "@/lib/config/base-url";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ReferralPanel } from "@/components/referrals/ReferralPanel";

export const metadata = { title: "Invite a friend" };
export const dynamic = "force-dynamic";

/** A tutor's own referral code. The same scheme, the same rules (§41 Phase 2). */
export default async function TutorReferralsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/referrals");
  await connectToDatabase();

  const [summary, balanceCents] = await Promise.all([
    referralSummary(user),
    creditBalance(user.id),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Invite a friend"
        description="Share your code with families and tutors you know."
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
