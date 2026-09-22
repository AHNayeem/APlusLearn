import { getAppConfig } from "@/services/settings.service";
import { themeColor } from "@/lib/theme/tokens";

/**
 * Web app manifest, served at `/manifest.webmanifest` (§26).
 *
 * The identity in here is the configured one, for the same reason the page
 * title and the footer are: renaming the platform from the admin panel has to
 * rename the thing on the home screen too, or an installed copy keeps saying
 * "APlus Learn" after the operator has called it something else.
 *
 * The *icons* are the shipped set, not the uploaded branding assets, and that
 * is deliberate. Installability depends on an icon of a declared size actually
 * being that size; the branding uploads are validated as square and bounded
 * but their exact dimensions vary per deployment, so declaring a size for them
 * would be a claim this code cannot make. `public/icons/*` are generated from
 * `public/icon.svg` by `scripts/pwa-icons.mjs` at known sizes, including a
 * maskable pair with the safe zone respected. An operator who rebrands edits
 * that SVG and reruns the script — the tab favicon and the Apple touch icon
 * remain overridable from the panel through the root layout's metadata.
 *
 * `start_url` and `scope` are the origin root. The marketing home page is the
 * right landing spot for an installed copy: it is the one route that renders
 * for a signed-out visitor and redirects nobody, and a signed-in person is
 * carried on to their dashboard by the header they already use.
 */

/**
 * Regenerated hourly rather than frozen at build time, so a change to the
 * application's name, description or theme colour reaches an installed copy
 * without a redeploy — the same contract `robots.js` and `sitemap.js` keep.
 */
export const revalidate = 3600;

export default async function manifest() {
  const { branding, theme, seo } = await getAppConfig();

  return {
    name: branding.appName,
    short_name: branding.shortName,
    description: seo.metaDescription || branding.description,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // The page ground, so the splash screen Android draws while the
    // application boots is the colour the application then paints.
    background_color: theme.canvasColor || "#f7f9fc",
    theme_color: themeColor(theme),
    lang: "en-CA",
    dir: "ltr",
    categories: ["education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
