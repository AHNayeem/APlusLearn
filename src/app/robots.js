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

/**
 * Every signed-in area, by its first path segment (§29).
 *
 * Each one sits behind `enforceRole`/`enforceAuth`, so a crawler that follows
 * a link to it gets a redirect to the sign-in page — a URL that is not worth
 * a crawl. `/tutors` is listed with an end anchor: the bare path is the
 * family's own "My tutors" list, while `/tutors/<slug>` is a public profile
 * and must stay crawlable.
 */
const PRIVATE_PATHS = [
  "/api/",
  // Family workspace — src/app/(dashboard)
  "/dashboard",
  "/bookings",
  "/children",
  "/favourites",
  "/insights",
  "/messages",
  "/my-groups",
  "/notifications",
  "/packages",
  "/payments",
  "/progress",
  "/referrals",
  "/requests",
  "/reviews",
  "/settings",
  "/tutors$",
  // Tutor and admin workspaces
  "/tutor/",
  "/admin/",
  // Account flows — src/app/(auth), except registration — and development tools
  "/login",
  "/verify-email",
  "/reset-password",
  "/forgot-password",
  "/dev/",
  "/offline",
];

export default async function robots() {
  const [BASE, { seo }] = await Promise.all([siteBaseUrl(), getAppConfig()]);
  // `Host` takes a host name, not a URL.
  const host = new URL(BASE).host;

  if (!seo.allowIndexing) {
    return { rules: [{ userAgent: "*", disallow: "/" }], host };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: `${BASE}/sitemap.xml`,
    host,
  };
}
