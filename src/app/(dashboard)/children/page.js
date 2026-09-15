import { Suspense } from "react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, ROLES } from "@/constants";
import { listStudents } from "@/services/student.service";
import { listGrades, listSubjects } from "@/services/curriculum.service";
import { SkeletonList } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ChildrenManager } from "@/components/dashboard/ChildrenManager";

export const metadata = { title: "Children" };
export const dynamic = "force-dynamic";

export default async function ChildrenPage() {
  const user = await enforceRole(LEARNER_ROLES, "/children");
  await connectToDatabase();

  const [students, grades, subjects] = await Promise.all([
    listStudents(user),
    listGrades({ provinceCode: user.province ?? "ON" }),
    listSubjects(),
  ]);

  const isParent = user.role === ROLES.PARENT;

  return (
    <DashboardPage>
      <PageHeader
        title={isParent ? "Children" : "My learner profile"}
        description={
          isParent
            ? "Each child gets their own grade, courses and lesson history."
            : "Keep your grade and courses current so tutors can prepare."
        }
      />
      <Suspense fallback={<SkeletonList count={2} />}>
        <ChildrenManager
          students={students}
          grades={grades}
          subjects={subjects}
          canManage={isParent}
        />
      </Suspense>
    </DashboardPage>
  );
}
