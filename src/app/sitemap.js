import { connectToDatabase } from "@/lib/db/connect";
import { TutorProfile } from "@/models";
import { LEGAL_SLUGS } from "@/constants";
import { siteBaseUrl } from "@/lib/config/base-url";
import { landingSitemapEntries } from "@/services/landing.service";

/**
 * Sitemap (§29, §32).
 *
 * Covers the marketing pages, the legal pages, every searchable tutor profile
 * and the curriculum landing pages: province, province + subject, grade +
 * subject, course, and topic + city. The landing URLs come from
 * `landingSitemapEntries`, which builds them with the same rules the pages
 * resolve them by — so nothing listed here 404s, redirects, or renders empty,
 * and a topic + city page is only listed where a tutor actually lists that
 * city. Private dashboard routes are excluded — they're behind auth and
 * shouldn't be crawled.
 */
/**
 * Regenerated hourly: new tutors and courses appear without a redeploy, and a
 * changed canonical base URL propagates the same way (§18).
 */
export const revalidate = 3600;

const PRIORITY = {
  PROVINCE: 0.8,
  PROVINCE_SUBJECT: 0.7,
  GRADE_SUBJECT: 0.6,
  COURSE: 0.6,
  COURSE_CITY: 0.5,
  SUBJECT_CITY: 0.5,
};

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
    { url: "/help-centre", priority: 0.5, changeFrequency: "monthly" },
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

    const [tutors, landing] = await Promise.all([
      TutorProfile.find({ isSearchable: true }).select("slug updatedAt").limit(5000).lean(),
      landingSitemapEntries(),
    ]);

    const tutorPages = tutors.map((tutor) => ({
      url: `${BASE}/tutors/${tutor.slug}`,
      lastModified: tutor.updatedAt ?? now,
      changeFrequency: "weekly",
      priority: 0.8,
    }));

    const landingPages = landing.map((entry) => ({
      url: `${BASE}${entry.path}`,
      lastModified: entry.lastModified ?? now,
      changeFrequency: "weekly",
      priority: entry.kind === "COURSE" && entry.popular ? 0.8 : PRIORITY[entry.kind] ?? 0.5,
    }));

    return [...staticPages, ...legalPages, ...tutorPages, ...landingPages];
  } catch (error) {
    // A database problem shouldn't produce a broken sitemap — serve the
    // static pages rather than a 500.
    console.error("[sitemap] falling back to static pages:", error.message);
    return [...staticPages, ...legalPages];
  }
}
