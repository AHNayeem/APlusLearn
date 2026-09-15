import { siteBaseUrl } from "@/lib/config/base-url";
import { getAppConfig } from "@/services/settings.service";

/**
 * Crawl the public marketplace; keep private and transactional areas out (§29).
 *
 * The disallow list is code, not configuration: which routes are private is a
 * property of the application, and an operator cannot make `/admin` safe to
 * index by editing a form. What *is* configurable is whether this deployment
 * should be indexed at all — a staging copy is turned off from the admin panel
 * rather than by shipping a different build (§26).
 */
/**
 * Regenerated hourly rather than frozen at build time, so switching indexing
 * off in the admin panel takes effect without a redeploy (§18, §26).
 */
export const revalidate = 3600;

export default async function robots() {
  const [BASE, { seo }] = await Promise.all([siteBaseUrl(), getAppConfig()]);

  if (!seo.allowIndexing) {
    return { rules: [{ userAgent: "*", disallow: "/" }], host: BASE };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/bookings",
          "/messages",
          "/payments",
          "/children",
          "/favourites",
          "/requests",
          "/reviews",
          "/notifications",
          "/settings",
          "/tutor/",
          "/admin/",
          "/verify-email",
          "/reset-password",
          "/forgot-password",
          "/login",
        ],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
