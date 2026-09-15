import { z } from "zod";
import { routeHandler, fail } from "@/lib/api";
import { readBrandingAsset } from "@/services/branding.service";
import { BRANDING_ASSET_KEYS } from "@/constants";

/**
 * Public delivery of the configured logo, icons and social image (§26, §18).
 *
 * Public on purpose — these appear in the header of every page, in the browser
 * tab, and in link previews rendered by services that will never hold a
 * session. What keeps it safe is that the URL names a *setting*, not a file:
 * there is no key to guess and nothing to enumerate, and the bytes were
 * format-checked before they were ever stored.
 *
 * Responses are immutable and long-lived. Replacing an asset changes the `v`
 * query string every page emits, so the new file is a new URL and no visitor
 * is left looking at last month's logo (§18).
 */

const paramsSchema = z.object({ asset: z.enum(BRANDING_ASSET_KEYS) });

export const GET = routeHandler(
  async ({ params, request }) => {
    try {
      const { body, contentType, uploadedAt } = await readBrandingAsset(params.asset);
      const versioned = new URL(request.url).searchParams.has("v");

      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(body.length),
          "Cache-Control": versioned
            ? "public, max-age=31536000, immutable"
            : "public, max-age=300, stale-while-revalidate=86400",
          "Last-Modified": new Date(uploadedAt ?? Date.now()).toUTCString(),
          // Uploaded media is served as an image or not at all.
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
        },
      });
    } catch (error) {
      if (error.status === 404) {
        // A missing optional asset is a normal state, not an incident: the
        // layout simply falls back to the drawn wordmark (§19).
        return fail("No image is configured for that.", { status: 404, code: "NOT_FOUND" });
      }
      throw error;
    }
  },
  { paramsSchema },
);
