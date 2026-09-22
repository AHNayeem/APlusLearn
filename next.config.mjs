import { REMOTE_IMAGE_HOSTS } from "./src/constants/config.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,

  /**
   * The local verification-document store reads from a runtime-configured
   * path, which Turbopack cannot analyse statically. Without this it traces
   * the entire project into the server bundle. The directory is written and
   * read at runtime, so nothing needs to be traced into the build at all.
   */
  outputFileTracingExcludes: {
    "**": [".storage/**", "docs/**", "scripts/**"],
  },

  images: {
    // Tutor avatars are user-supplied URLs; only these hosts are permitted.
    // The list lives in the application so the UI can check a photo against
    // the same one before rendering it — an unlisted host makes `next/image`
    // throw, and the UI's job is to fall back instead of letting it.
    remotePatterns: REMOTE_IMAGE_HOSTS.map((hostname) => ({ protocol: "https", hostname })),
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
          },
        ],
      },
      {
        /**
         * The service worker script must never be served from a cache (§18).
         *
         * `updateViaCache: "none"` on the registration already asks the
         * browser to bypass its HTTP cache for this file, but a CDN in front
         * of the deployment was never told that. Without this header a proxy
         * can hold the previous build's worker — and its cache rules — long
         * after the code it caches for has been replaced.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          // The worker lives at the origin root and claims the root scope. The
          // header is what permits that if the file is ever moved or proxied
          // from a subdirectory.
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        /**
         * Generated from `public/icon.svg` and changed only by a rebrand, but
         * referenced by the manifest, by iOS and by the installed copy's
         * launcher — a day is long enough to be worth caching and short
         * enough that a rebrand lands the same day.
         */
        source: "/icons/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },
};

export default nextConfig;
