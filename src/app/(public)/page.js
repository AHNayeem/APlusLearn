import { connectToDatabase } from "@/lib/db/connect";
import {
  listProvinces, listGrades, listSubjects, popularCourses, defaultProvinceCode,
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
import { JsonLd } from "@/components/seo/JsonLd";

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

  // The homepage starts on the first live province in the administrator's
  // order — read from the data, so launching or reordering provinces changes
  // it without a deployment (§6). The hero then reloads grades and subjects
  // for whichever province the visitor picks.
  const provinceCode = await defaultProvinceCode();

  const [provinces, grades, heroSubjects, subjects, courses, stats, settings, reviews, ratingAgg, topTutors] =
    await Promise.all([
      listProvinces({ activeOnly: false }),
      provinceCode ? listGrades({ provinceCode }) : [],
      provinceCode ? listSubjects({ provinceCode }) : listSubjects(),
      listSubjects({ popularOnly: true }),
      provinceCode ? popularCourses(6, provinceCode) : popularCourses(6),
      marketplaceStats(),
      getSettings(),
      Review.find({ status: REVIEW_STATUS.PUBLISHED, body: { $exists: true } })
        .sort({ rating: -1, createdAt: -1 })
        .limit(24)
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

  const live = provinces.find((p) => p.code === provinceCode);
  const province = live ? { code: live.code, name: live.name, slug: live.slug } : null;

  // The homepage rail shows quotes shoulder to shoulder, where two families
  // praising a tutor in the same words reads as a rendering bug rather than as
  // agreement. One card per distinct review, then the first eight.
  const distinctReviews = [
    ...new Map(toPlain(reviews).map((review) => [review.body.trim(), review])).values(),
  ].slice(0, 8);

  const testimonials = distinctReviews.map((review) => ({
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
        subjects={heroSubjects}
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
      <PopularCourses courses={courses} province={province} />
      <TutorsByGrade grades={grades} province={province} />
      <WhyChoose />
      <VerificationSection />
      <LessonModes />
      <Testimonials reviews={testimonials} />
      <BecomeTutorCta commissionPercent={settings.commissionPercent} />
      <Faq faqs={HOME_FAQS.slice(0, 6)} />

      {/* Structured data so the FAQ can surface in search results (§29). */}
      <JsonLd
        data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: HOME_FAQS.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          }}
      />
    </>
  );
}
