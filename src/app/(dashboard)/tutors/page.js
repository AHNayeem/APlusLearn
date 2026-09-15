import { Users, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listMyTutors } from "@/services/tutor.service";
import { Badge, Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { TutorCard } from "@/components/tutor/TutorCard";
import { formatRelative } from "@/lib/utils/format";

export const metadata = { title: "My tutors" };
export const dynamic = "force-dynamic";

export default async function MyTutorsPage() {
  const user = await enforceRole(LEARNER_ROLES, "/tutors");
  await connectToDatabase();

  const tutors = await listMyTutors(user.id);

  return (
    <DashboardPage>
      <PageHeader
        title="My tutors"
        description="Everyone you've had a lesson with — rebook in two taps."
        action={
          <Button href="/find-a-tutor" iconLeft={<Search className="size-4" />}>
            Find someone new
          </Button>
        }
      />

      {tutors.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="No tutors yet"
          description="Once you've booked a lesson, that tutor appears here so you can rebook quickly."
          action={<Button href="/find-a-tutor">Find a tutor</Button>}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {tutors.map((tutor) => (
            <div key={tutor.id} className="relative">
              <TutorCard tutor={tutor} />
              <div className="absolute right-4 top-4 flex flex-col items-end gap-1">
                {tutor.upcomingCount > 0 && (
                  <Badge tone="success" size="sm">
                    {tutor.upcomingCount} upcoming
                  </Badge>
                )}
                {tutor.lessonCount > 0 && (
                  <Badge tone="neutral" size="sm">
                    {tutor.lessonCount} completed
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardPage>
  );
}
