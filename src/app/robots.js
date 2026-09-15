const BASE = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Crawl the public marketplace; keep private and transactional areas out (§29). */
export default function robots() {
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
