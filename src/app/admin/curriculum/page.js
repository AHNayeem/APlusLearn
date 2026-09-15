import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import {
  listProvinces, listGrades, listSubjects, listCourses,
} from "@/services/curriculum.service";
import { Alert } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { CurriculumManager } from "@/components/admin/CurriculumManager";

export const metadata = { title: "Curriculum" };
export const dynamic = "force-dynamic";

export default async function AdminCurriculumPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/curriculum");
  await connectToDatabase();

  const { q, province = "ON" } = await searchParams;

  const [provinces, grades, subjects, courseResult] = await Promise.all([
    listProvinces({ activeOnly: false }),
    listGrades({ provinceCode: province }),
    listSubjects(),
    listCourses({ q, province, pageSize: 100, activeOnly: false }),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="Curriculum"
        description="Provinces, grades, subjects and courses. This is what search and tutor onboarding read from."
      />

      <Alert tone="info" title="Adding a province" className="mb-6">
        Create the province, add its grades, then its courses. Nothing appears in search until the
        province is marked open and at least one approved tutor teaches a course in it.
      </Alert>

      <CurriculumManager
        provinces={provinces}
        grades={grades}
        subjects={subjects}
        courses={courseResult.items}
        courseTotal={courseResult.total}
      />
    </DashboardPage>
  );
}
