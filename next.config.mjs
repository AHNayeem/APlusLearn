import { REMOTE_IMAGE_HOSTS } from "./src/constants/config.js";

/**
 * Is this build serving production traffic?
 *
 * Read here, at configuration time, because `headers()` is evaluated once per
 * process rather than per request — which is exactly right for the two
 * headers that must differ between a developer's `http://localhost` and a
 * deployment behind TLS.
 */
const isProduction =
  (process.env.APP_ENV ?? process.env.NODE_ENV) === "production" ||
  process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy (§36).
 *
 * Every directive below is as narrow as the application actually allows, with
 * two deliberate exceptions that are worth stating plainly rather than
 * burying:
 *
 * **`script-src` carries `'unsafe-inline'`.** Next.js streams the React
 * Server Component payload to the browser as inline `<script>` elements, and
 * the marketplace's structured data (`application/ld+json` on the homepage,
 * FAQ, course and tutor pages) is inline too. The alternative is a per-request
 * nonce, which Next supports — but reading a nonce opts every page into
 * dynamic rendering, and this application's public, SEO-facing pages are
 * prerendered on purpose. Trading the whole marketplace's static rendering
 * for a policy that still has to allow the framework's own inline bootstrap
 * is not a good exchange, so the nonce is left as a documented next step for
 * whoever decides the rendering cost is worth it.
 *
 *   What the policy still buys, with inline allowed: no script may be *loaded*
 *   from another origin, `object-src 'none'` removes plugin content entirely,
 *   `base-uri 'self'` stops a `<base>` injection retargeting every relative
 *   URL, `form-action 'self'` stops a form being posted to somebody else's
 *   server, and `frame-ancestors` is the modern clickjacking control.
 *
 * **`style-src` carries `'unsafe-inline'`.** The operator's configured theme
 * is emitted as an inline `<style>` in the root layout (see `buildThemeCss`),
 * which is how a branding change takes effect without a rebuild.
 *
 * **`'unsafe-eval'` is development only.** Turbopack's hot-module client
 * evaluates code at runtime; production has no such requirement and does not
 * get the permission.
 */
function contentSecurityPolicy() {
  const imageHosts = REMOTE_IMAGE_HOSTS.map((host) => `https://${host}`).join(" ");

  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // `data:` and `blob:` are how an upload preview and a canvas-drawn icon
    // reach an <img> before anything has been stored.
    `img-src 'self' data: blob: ${imageHosts}`,
    // Fonts are self-hosted by `next/font`, so nothing external is needed.
    "font-src 'self' data:",
    // The API, the service worker and the image optimizer are all same-origin.
    // Development adds the HMR socket, which production has no use for.
    `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Nothing in the product embeds a third party. Meeting rooms and hosted
    // checkout are navigations, not frames.
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Matches the X-Frame-Options below rather than contradicting it.
    "frame-ancestors 'self'",
  ];

  if (isProduction) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}

/**
 * Strict-Transport-Security.
 *
 * Production only, because a browser that is told to pin `localhost` to HTTPS
 * keeps doing so long after the developer has moved on, and there is no
 * convenient way to take it back.
 *
 * One year, and deliberately **without** `includeSubDomains` or `preload`.
 * Both are one-way doors that depend on facts this repository cannot know —
 * whether every subdomain of the deployment's apex domain is served over TLS,
 * and whether the operator is willing to be in a list that is slow to leave.
 * A deployment that has checked both should add them here.
 */
const HSTS = "max-age=31536000";

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
          ...(isProduction ? [{ key: "Strict-Transport-Security", value: HSTS }] : []),
        ],
      },
      {
        /**
         * The document policy, applied everywhere *except* the API.
         *
         * A header declared here replaces one a route handler set, and two
         * API routes set a deliberately stricter policy of their own: the
         * verification-document route sandboxes the identity paperwork it
         * streams (`default-src 'none'; … sandbox`), and nothing weaker
         * should ever be put in its place. A policy on a JSON response
         * governs nothing anyway — CSP is a property of a document — so
         * excluding `/api` costs nothing and keeps those two routes the
         * authority on their own bytes (§35, §36).
         */
        source: "/((?!api/).*)",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy() }],
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
