import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, REQUEST_STATUS } from "@/constants";
import { getRequest } from "@/services/request.service";
import { listStudents } from "@/services/student.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RequestForm } from "@/components/dashboard/RequestForm";

export const metadata = { title: "Edit tutor request", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Edit an open request (§41 Phase 2).
 *
 * A closed request is sent back to its detail page rather than shown in a
 * form that would fail on submit — the server refuses the edit either way,
 * but there is no reason to let someone fill it in first.
 */
export default async function EditRequestPage({ params }) {
  const { id } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/requests/${id}/edit`);
  await connectToDatabase();

  const request = await getRequest(id, user).catch(() => null);
  if (!request) notFound();
  if (String(request.ownerId) !== String(user.id)) notFound();
  if (request.status !== REQUEST_STATUS.OPEN) redirect(`/requests/${id}`);

  const students = await listStudents(user);

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href={`/requests/${id}`}
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            Back to request
          </Link>
        }
        title="Edit your request"
        description="Saving re-runs matching and tells the tutors who already replied that the brief changed."
      />

      <div className="max-w-3xl">
        <RequestForm students={students} request={request} />
      </div>
    </DashboardPage>
  );
}
