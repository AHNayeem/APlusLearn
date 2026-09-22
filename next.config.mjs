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
    ];
  },
};

export default nextConfig;
