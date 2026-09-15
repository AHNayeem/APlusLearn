import { ArrowRight } from "lucide-react";
import { featuredTutors } from "@/services/search.service";
import { Button, EmptyState, RevealGroup, RevealItem } from "@/components/ui";
import { TutorCard } from "@/components/tutor/TutorCard";
import { Section } from "./Sections";

/**
 * Top-rated tutors on the homepage. A Server Component so the cards are in
 * the initial HTML — good for both perceived speed and SEO (§43).
 */
export async function FeaturedTutors() {
  const tutors = await featuredTutors({ limit: 3 });

  return (
    <Section
      eyebrow="Top rated"
      title="Tutors families keep rebooking"
      description="Ranked by verified reviews and completed lessons — not by who paid for placement."
      action={
        <Button href="/find-a-tutor" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
          Browse all tutors
        </Button>
      }
    >
      {tutors.length === 0 ? (
        <EmptyState
          title="No tutors are listed yet"
          description="Tutor profiles appear here as soon as our team approves them."
          action={<Button href="/become-a-tutor">Become the first tutor</Button>}
        />
      ) : (
        <RevealGroup className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {tutors.map((tutor) => (
            <RevealItem key={tutor.id}>
              <TutorCard tutor={tutor} />
            </RevealItem>
          ))}
        </RevealGroup>
      )}
    </Section>
  );
}
