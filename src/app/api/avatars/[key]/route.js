import { z } from "zod";
import { routeHandler, fail } from "@/lib/api";
import { readAvatar } from "@/services/user.service";

/**
 * Serve one profile photo (§8, §16).
 *
 * The path names a storage key, and the service turns that key back into the
 * account currently holding it before a single byte is read — so this can only
 * ever return a file that *is* somebody's avatar right now. A verification
 * document's key resolves to nothing here, a replaced photo's key resolves to
 * nothing, and a guessed key resolves to nothing: the keys are UUIDs this
 * application generated, so there is no series to walk.
 *
 * The shape of the key is checked before the lookup, not because the store
 * would accept anything else — `safeKey` refuses a path either way — but so a
 * malformed request is a 400 from the edge of the application rather than a
 * database round trip.
 *
 * Caching mirrors who may see it. A tutor's photo is public marketplace
 * content and may sit in a shared cache; everybody else's is `private`, so it
 * is kept by the browser that was authorised for it and by nothing in between.
 * Both are immutable, which is safe precisely because replacing a photo mints
 * a new key: the URL for the old bytes stops existing rather than changing
 * meaning, so nobody is left looking at a face that was taken down (§18).
 */
const paramsSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "That is not a photo."),
});

export const GET = routeHandler(
  async ({ params, user }) => {
    try {
      const { body, contentType, uploadedAt, isPublic } = await readAvatar(params.key, user);

      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(body.length),
          "Cache-Control": isPublic
            ? "public, max-age=31536000, immutable"
            : "private, max-age=31536000, immutable",
          "Last-Modified": new Date(uploadedAt ?? Date.now()).toUTCString(),
          // Uploaded media is served as the image its bytes proved to be, or
          // not at all.
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": "inline",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Referrer-Policy": "no-referrer",
        },
      });
    } catch (error) {
      // A photo that has been replaced or removed is an ordinary state, not an
      // incident: the avatar falls back to the person's initials.
      if (error.status === 404) {
        return fail("That photo is not available.", { status: 404, code: "NOT_FOUND" });
      }
      throw error;
    }
  },
  { paramsSchema },
);
