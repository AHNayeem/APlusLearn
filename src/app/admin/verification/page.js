import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import { pendingVerificationQueue } from "@/services/verification.service";
import { Alert, Pagination } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { VerificationQueue } from "@/components/admin/VerificationQueue";

export const metadata = { title: "Verification queue" };
export const dynamic = "force-dynamic";

export default async function AdminVerificationPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/verification");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize } = await pendingVerificationQueue({ page: Number(page) });

  return (
    <DashboardPage>
      <PageHeader
        title="Verification queue"
        description="Documents waiting on a decision. Each badge you grant is recorded against your account."
      />

      <Alert tone="warning" title="Open every document before granting a badge" className="mb-6">
        A badge is a promise to families that we checked something specific. Documents are served
        through an audited route and are never public.
      </Alert>

      <VerificationQueue records={items} />

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="documents"
        buildHref={(p) => `/admin/verification?page=${p}`}
      />
    </DashboardPage>
  );
}
