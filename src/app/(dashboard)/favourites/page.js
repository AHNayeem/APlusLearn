import { Heart, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listFavourites } from "@/services/student.service";
import { toPublicTutor, attachAvailableWeekdays } from "@/services/tutor.service";
import { Button, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { TutorCard } from "@/components/tutor/TutorCard";

export const metadata = { title: "Saved tutors" };
export const dynamic = "force-dynamic";

export default async function FavouritesPage() {
  const user = await enforceRole(LEARNER_ROLES, "/favourites");
  await connectToDatabase();

  const favourites = await listFavourites(user);
  const tutors = await attachAvailableWeekdays(
    favourites.map((favourite) => ({
      ...toPublicTutor(favourite.tutorProfileId, favourite.tutorProfileId.userId),
      isFavourite: true,
    })),
  );

  return (
    <DashboardPage>
      <PageHeader
        title="Saved tutors"
        description="Shortlist tutors while you compare, then book when you're ready."
        action={
          <Button href="/find-a-tutor" iconLeft={<Search className="size-4" />}>
            Browse tutors
          </Button>
        }
      />

      {tutors.length === 0 ? (
        <EmptyState
          icon={<Heart className="size-7" />}
          title="No saved tutors yet"
          description="Tap the heart on any tutor to keep them here while you decide."
          action={<Button href="/find-a-tutor">Find tutors</Button>}
        />
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {tutors.map((tutor) => (
            <TutorCard key={tutor.id} tutor={tutor} />
          ))}
        </div>
      )}
    </DashboardPage>
  );
}
