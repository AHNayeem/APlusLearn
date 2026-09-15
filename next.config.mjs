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
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
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
    ];
  },
};

export default nextConfig;
