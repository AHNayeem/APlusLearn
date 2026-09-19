import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listStudents } from "@/services/student.service";
import { Alert, Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { RequestForm } from "@/components/dashboard/RequestForm";

export const metadata = {
  title: "Post a tutor request",
  description: "Describe what you need and let matching tutors come to you.",
};
export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  const user = await enforceRole(LEARNER_ROLES, "/requests/new");
  await connectToDatabase();

  const students = await listStudents(user);

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/requests"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            My requests
          </Link>
        }
        title="Post a tutor request"
        description="Instead of searching, describe what you need and let matching tutors reach out."
      />

      <div className="max-w-3xl">
        {students.length === 0 ? (
          <EmptyState
            title="Add your child first"
            description="We need to know who the lessons are for before posting a request."
            action={<Button href="/children?new=1">Add a child</Button>}
          />
        ) : (
          <RequestForm students={students} />
        )}
      </div>
    </DashboardPage>
  );
}
