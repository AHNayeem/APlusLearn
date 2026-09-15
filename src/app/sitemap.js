import { connectToDatabase } from "@/lib/db/connect";
import { Course, TutorProfile, Province } from "@/models";
import { LEGAL_SLUGS } from "@/constants";
import { SERVICE_CITIES } from "@/lib/geo";
import { siteBaseUrl } from "@/lib/config/base-url";

/**
 * Sitemap (§29).
 *
 * Covers the marketing pages, every approved tutor profile, every active
 * course, and the course+city long-tail pages. Private dashboard routes are
 * excluded — they're behind auth and shouldn't be crawled.
 */
/**
 * Regenerated hourly: new tutors and courses appear without a redeploy, and a
 * changed canonical base URL propagates the same way (§18).
 */
export const revalidate = 3600;

export default async function sitemap() {
  const now = new Date();
  const BASE = await siteBaseUrl();

  const staticPages = [
    { url: "", priority: 1, changeFrequency: "daily" },
    { url: "/find-a-tutor", priority: 0.9, changeFrequency: "daily" },
    { url: "/courses", priority: 0.9, changeFrequency: "weekly" },
    { url: "/become-a-tutor", priority: 0.8, changeFrequency: "monthly" },
    { url: "/how-it-works", priority: 0.7, changeFrequency: "monthly" },
    { url: "/verification", priority: 0.7, changeFrequency: "monthly" },
    { url: "/pricing", priority: 0.7, changeFrequency: "monthly" },
    { url: "/safety", priority: 0.6, changeFrequency: "monthly" },
    { url: "/about", priority: 0.6, changeFrequency: "monthly" },
    { url: "/faq", priority: 0.6, changeFrequency: "monthly" },
    { url: "/support", priority: 0.5, changeFrequency: "monthly" },
    { url: "/register", priority: 0.5, changeFrequency: "yearly" },
  ].map((page) => ({
    url: `${BASE}${page.url}`,
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  const legalPages = LEGAL_SLUGS.map((slug) => ({
    url: `${BASE}/legal/${slug}`,
    lastModified: now,
    changeFrequency: "yearly",
    priority: 0.3,
  }));

  try {
    await connectToDatabase();

    const [tutors, courses, provinces] = await Promise.all([
      TutorProfile.find({ isSearchable: true }).select("slug updatedAt").limit(5000).lean(),
      Course.find({ isActive: true })
        .select("slug code gradeSlug subjectSlug provinceCode isPopular updatedAt")
        .limit(2000)
        .lean(),
      Province.find({ isActive: true }).select("code slug").lean(),
    ]);

    const provinceSlug = new Map(provinces.map((p) => [p.code, p.slug]));

    const tutorPages = tutors.map((tutor) => ({
      url: `${BASE}/tutors/${tutor.slug}`,
      lastModified: tutor.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.8,
    }));

    const coursePages = courses
      .filter((course) => provinceSlug.has(course.provinceCode))
      .map((course) => ({
        url: `${BASE}/${provinceSlug.get(course.provinceCode)}/${course.gradeSlug}/${course.subjectSlug}/${course.code ? course.code.toLowerCase() : course.slug}`,
        lastModified: course.updatedAt ?? now,
        changeFrequency: "weekly",
        priority: course.isPopular ? 0.8 : 0.6,
      }));

    // Course + city pages, limited to popular coded courses so the sitemap
    // stays a useful signal rather than a combinatorial explosion.
    const cityPages = courses
      .filter((course) => course.code && course.isPopular)
      .flatMap((course) =>
        SERVICE_CITIES.filter((city) => city.province === course.provinceCode).map((city) => ({
          url: `${BASE}/tutors/${course.code.toLowerCase()}/${city.city.toLowerCase().replace(/\s+/g, "-")}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.5,
        })),
      );

    return [...staticPages, ...legalPages, ...tutorPages, ...coursePages, ...cityPages];
  } catch (error) {
    // A database problem shouldn't produce a broken sitemap — serve the
    // static pages rather than a 500.
    console.error("[sitemap] falling back to static pages:", error.message);
    return [...staticPages, ...legalPages];
  }
}
