import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES } from "@/constants";
import {
  listProvinces, listGrades, listSubjects, listCourses, defaultProvinceCode,
} from "@/services/curriculum.service";
import { Alert } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { CurriculumManager } from "@/components/admin/CurriculumManager";

export const metadata = { title: "Curriculum" };
export const dynamic = "force-dynamic";

const COURSE_PAGE_SIZE = 50;

export default async function AdminCurriculumPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/curriculum");
  await connectToDatabase();

  const params = await searchParams;
  const provinces = await listProvinces({ activeOnly: false });

  // The province being edited: the one asked for, else the first live one,
  // else the first that exists — read from the data, never assumed.
  const requested = String(params.province ?? "").toUpperCase();
  const province =
    provinces.find((p) => p.code === requested)?.code ??
    (await defaultProvinceCode()) ??
    provinces[0]?.code ??
    null;

  // Courses are paged rather than capped, so a province with more courses
  // than one screen holds still has every one of them reachable (R28.12).
  const page = Math.min(Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1), 500);

  // The administrator's view includes everything deactivated, or a hidden
  // grade or subject could never be switched back on (R28.10, R28.11).
  const [grades, subjects, courseResult] = await Promise.all([
    province ? listGrades({ provinceCode: province, activeOnly: false }) : [],
    listSubjects({ activeOnly: false }),
    province
      ? listCourses({ q: params.q, province, page, pageSize: COURSE_PAGE_SIZE, activeOnly: false })
      : { items: [], total: 0, page: 1, pageSize: COURSE_PAGE_SIZE, totalPages: 1 },
  ]);
  const q = params.q;

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
        province={province}
        query={q ?? ""}
        provinces={provinces}
        grades={grades}
        subjects={subjects}
        courses={courseResult.items}
        courseTotal={courseResult.total}
        coursePage={{
          page: courseResult.page ?? page,
          pageSize: courseResult.pageSize ?? COURSE_PAGE_SIZE,
          totalPages: courseResult.totalPages ?? 1,
        }}
      />
    </DashboardPage>
  );
}
