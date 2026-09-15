import { Plus_Jakarta_Sans } from "next/font/google";
import { getAppConfig } from "@/services/settings.service";
import { buildThemeCss, themeColor } from "@/lib/theme/tokens";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

/** The icon shipped with the build, used until an administrator uploads one. */
const FALLBACK_ICON = "/icon.svg";

function baseUrl(config) {
  return (
    config.seo.canonicalBaseUrl ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

/**
 * Global metadata, generated from platform settings (§26, §29).
 *
 * This is the *floor*, not the ceiling. Next merges a page's own
 * `generateMetadata` over it, so a tutor profile or course page keeps its
 * specific title, description and canonical — configuring the application name
 * changes the suffix those titles hang off, never the titles themselves.
 *
 * `getAppConfig()` cannot throw, so a database that is slow, unreachable, or
 * simply absent during a build still produces a complete, valid document head.
 */
export async function generateMetadata() {
  const config = await getAppConfig();
  const { branding, seo } = config;
  const base = baseUrl(config);

  const suffix = seo.titleSuffix || branding.appName;
  const icon = branding.favicon ?? FALLBACK_ICON;

  return {
    metadataBase: new URL(base),
    title: {
      default: seo.title,
      template: `%s · ${suffix}`,
    },
    description: seo.metaDescription,
    applicationName: branding.appName,
    keywords: seo.keywords,
    authors: [{ name: branding.appName }],
    icons: {
      icon: [{ url: icon }],
      shortcut: [{ url: icon }],
      apple: [{ url: branding.appleTouchIcon ?? icon }],
    },
    openGraph: {
      type: "website",
      locale: "en_CA",
      siteName: branding.appName,
      title: seo.ogTitle,
      description: seo.ogDescription,
      ...(branding.ogImage ? { images: [{ url: branding.ogImage }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: seo.ogTitle,
      description: seo.ogDescription,
      ...(seo.twitterHandle ? { site: seo.twitterHandle, creator: seo.twitterHandle } : {}),
      ...(branding.ogImage ? { images: [branding.ogImage] } : {}),
    },
    // A staging deployment can be taken out of the index from the admin panel
    // without a code change or a redeploy.
    robots: seo.allowIndexing ? { index: true, follow: true } : { index: false, follow: false },
    formatDetection: { telephone: false },
  };
}

export async function generateViewport() {
  const { theme } = await getAppConfig();
  return {
    themeColor: themeColor(theme),
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

export default async function RootLayout({ children }) {
  const { theme } = await getAppConfig();

  // Configured colours are expanded into the token names `globals.css` already
  // declares. An untouched theme produces no CSS at all, so the shipped design
  // system is what renders (§19).
  const themeCss = buildThemeCss(theme);

  return (
    <html lang="en-CA" className={`${jakarta.variable} h-full`}>
      <body className="flex min-h-full flex-col antialiased">
        {/*
          Hoisted into <head> by React, which de-duplicates it by `href` and
          orders it by `precedence`. Rendered here rather than inside a
          hand-written <head>: a root layout must not author that element
          itself, or Next's own head management — the stylesheet link
          included — is reconciled away on hydration.

          Order against the Tailwind sheet is not relied on. `buildThemeCss`
          doubles the selector (`:root:root`) so the override wins on
          specificity whichever way the two are inserted.
        */}
        {themeCss && (
          <style href="aplus-theme" precedence="high">
            {themeCss}
          </style>
        )}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
