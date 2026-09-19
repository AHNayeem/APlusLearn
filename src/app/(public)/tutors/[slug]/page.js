import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { getPublicTutorBySlug, listTutorReviews } from "@/services/tutor.service";
import { ratingBreakdown } from "@/services/review.service";
import { isFavourite, listStudents } from "@/services/student.service";
import { listPublicPackages } from "@/services/package.service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { LEARNER_ROLES, SITE } from "@/constants";
import { formatRate } from "@/lib/utils/format";
import { TutorProfileHeader } from "@/components/tutor/TutorProfileHeader";
import {
  GallerySection, AboutSection, CoursesSection, CredentialsSection, TrustSection, ReviewsSection,
} from "@/components/tutor/TutorProfileBody";
import { BookingWidget } from "@/components/booking/BookingWidget";
import { PackageOffers } from "@/components/packages/PackageOffers";
import { MessageTutorPanel } from "@/components/messaging/MessageTutorPanel";

export async function generateMetadata({ params }) {
  const { slug } = await params;
  await connectToDatabase();
  const tutor = await getPublicTutorBySlug(slug);

  if (!tutor) return { title: "Tutor not found" };

  const courses = tutor.courses
    .map((c) => c.code ?? c.name)
    .slice(0, 4)
    .join(", ");

  return {
    title: `${tutor.displayName} — ${tutor.headline}`,
    description: `${tutor.displayName} tutors ${courses} in ${tutor.city}, ${tutor.province}. ${tutor.stats.ratingCount > 0 ? `Rated ${tutor.stats.ratingAverage.toFixed(1)}/5 from ${tutor.stats.ratingCount} verified reviews. ` : ""}${formatRate(tutor.hourlyRateCents)}. Book online or in person.`,
    alternates: { canonical: `/tutors/${tutor.slug}` },
    openGraph: {
      type: "profile",
      title: `${tutor.displayName} — ${tutor.headline}`,
      description: tutor.bio?.slice(0, 200),
    },
  };
}

export default async function TutorProfilePage({ params }) {
  const { slug } = await params;
  await connectToDatabase();

  const tutor = await getPublicTutorBySlug(slug);
  // An unapproved, suspended or non-existent tutor is a 404 — we never leak
  // that a profile exists but isn't approved (§16, §42).
  if (!tutor) notFound();

  const user = await getCurrentUser();

  const [{ items: reviews }, breakdown, saved, students, packages] = await Promise.all([
    listTutorReviews(tutor.id, { pageSize: 8 }),
    ratingBreakdown(tutor.id),
    isFavourite(tutor.id, user?.id),
    user && LEARNER_ROLES.includes(user.role) ? listStudents(user) : Promise.resolve([]),
    // Only packages actually on sale; the service decides that, not the page (§42).
    listPublicPackages(tutor.id),
  ]);

  return (
    <div className="bg-canvas pb-16">
      <TutorProfileHeader tutor={tutor} isFavourite={saved} />

      <div className="container-page py-8">
        <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
          <div className="min-w-0 space-y-6">
            <GallerySection tutor={tutor} />
            <AboutSection tutor={tutor} />
            <CoursesSection tutor={tutor} />
            <CredentialsSection tutor={tutor} />
            <TrustSection tutor={tutor} />
            <PackageOffers
              packages={packages}
              tutor={tutor}
              students={students.map((student) => ({
                id: student.id,
                firstName: student.firstName,
                gradeName: student.gradeName,
              }))}
              signedIn={Boolean(user && LEARNER_ROLES.includes(user.role))}
            />
            <ReviewsSection tutor={tutor} reviews={reviews} breakdown={breakdown} />
            <MessageTutorPanel tutor={tutor} user={user} />
          </div>

          <div className="lg:min-w-0">
            <BookingWidget
              tutor={tutor}
              user={user && { id: user.id, role: user.role, firstName: user.firstName }}
              students={students.map((s) => ({
                id: s.id,
                firstName: s.firstName,
                gradeName: s.gradeName,
              }))}
            />
          </div>
        </div>
      </div>

      {/* Structured data so tutor profiles can surface as rich results (§29). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Person",
            name: tutor.displayName,
            jobTitle: "Tutor",
            description: tutor.headline,
            address: {
              "@type": "PostalAddress",
              addressLocality: tutor.city,
              addressRegion: tutor.province,
              addressCountry: "CA",
            },
            ...(tutor.stats.ratingCount > 0 && {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: tutor.stats.ratingAverage,
                reviewCount: tutor.stats.ratingCount,
                bestRating: 5,
              },
            }),
            makesOffer: {
              "@type": "Offer",
              priceCurrency: SITE.currency,
              price: (tutor.hourlyRateCents / 100).toFixed(2),
              availability: tutor.acceptingNewStudents
                ? "https://schema.org/InStock"
                : "https://schema.org/LimitedAvailability",
            },
          }),
        }}
      />
    </div>
  );
}
