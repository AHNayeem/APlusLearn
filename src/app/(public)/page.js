import { connectToDatabase } from "@/lib/db/connect";
import {
  listProvinces, listGrades, listSubjects, popularCourses,
} from "@/services/curriculum.service";
import { featuredTutors, marketplaceStats } from "@/services/search.service";
import { getSettings } from "@/services/settings.service";
import { Review, TutorProfile } from "@/models";
import { REVIEW_STATUS } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { publicName } from "@/lib/utils/format";
import { Hero } from "@/components/home/Hero";
import {
  HowItWorks, PopularSubjects, PopularCourses, TutorsByGrade, WhyChoose,
  VerificationSection, LessonModes, Testimonials, BecomeTutorCta, Faq, HOME_FAQS,
} from "@/components/home/Sections";
import { FeaturedTutors } from "@/components/home/FeaturedTutors";

export const metadata = {
  title: "Find a verified Canadian tutor — by course code",
  description:
    "Search verified tutors by province, grade and exact course code. Compare rates and reviews, message free, and book online or in-person lessons across Canada.",
  alternates: { canonical: "/" },
};

// Public marketing content changes rarely; revalidate hourly rather than
// hitting the database on every visit (§43).
export const revalidate = 3600;

export default async function HomePage() {
  await connectToDatabase();

  const [provinces, grades, subjects, courses, stats, settings, reviews, ratingAgg, topTutors] =
    await Promise.all([
      listProvinces({ activeOnly: false }),
      listGrades({ provinceCode: "ON" }),
      listSubjects({ popularOnly: true }),
      popularCourses(6, "ON"),
      marketplaceStats(),
      getSettings(),
      Review.find({ status: REVIEW_STATUS.PUBLISHED, body: { $exists: true } })
        .sort({ rating: -1, createdAt: -1 })
        .limit(6)
        .populate("authorId", "firstName lastName")
        .lean(),
      TutorProfile.aggregate([
        { $match: { isSearchable: true, "stats.ratingCount": { $gt: 0 } } },
        {
          $group: {
            _id: null,
            average: { $avg: "$stats.ratingAverage" },
            reviews: { $sum: "$stats.ratingCount" },
          },
        },
      ]),
      // The hero's avatar stack. Same ordering as the "Top rated" section
      // below, so the faces at the top of the page are the faces you meet.
      featuredTutors({ limit: 4 }),
    ]);

  const testimonials = toPlain(reviews).map((review) => ({
    id: review.id,
    rating: review.rating,
    title: review.title,
    body: review.body,
    courseCode: review.courseCode,
    courseName: review.courseName,
    authorName: publicName(review.authorId?.firstName ?? "A", review.authorId?.lastName ?? ""),
  }));

  return (
    <>
      <Hero
        provinces={provinces}
        grades={grades}
        subjects={subjects}
        popularCourses={courses}
        topTutors={topTutors}
        stats={{
          ...stats,
          averageRating: ratingAgg[0]?.average ?? 0,
          reviewCount: ratingAgg[0]?.reviews ?? 0,
        }}
      />
      <HowItWorks />
      <PopularSubjects subjects={subjects} />
      <FeaturedTutors />
      <PopularCourses courses={courses} />
      <TutorsByGrade grades={grades} />
      <WhyChoose />
      <VerificationSection />
      <LessonModes />
      <Testimonials reviews={testimonials} />
      <BecomeTutorCta commissionPercent={settings.commissionPercent} />
      <Faq faqs={HOME_FAQS.slice(0, 6)} />

      {/* Structured data so the FAQ can surface in search results (§29). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: HOME_FAQS.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          }),
        }}
      />
    </>
  );
}
