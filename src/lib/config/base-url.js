import "server-only";
import { getAppConfig } from "@/services/settings.service";

/**
 * The origin every absolute URL is built from (§29).
 *
 * Deployment configuration wins by default — `NEXT_PUBLIC_APP_URL` is what the
 * server is actually reachable at, and production refuses to start without it.
 * The settings override exists for the case that URL cannot cover: a platform
 * served from one host but canonicalised to another (a custom domain in front
 * of a platform hostname), where the crawler must be told the public name.
 */
export function envBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export async function siteBaseUrl() {
  const { seo } = await getAppConfig();
  return (seo.canonicalBaseUrl || envBaseUrl()).replace(/\/$/, "");
}
