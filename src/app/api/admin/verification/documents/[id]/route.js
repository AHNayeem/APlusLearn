import { z } from "zod";
import { routeHandler } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { readVerificationDocument } from "@/services/verification.service";
import { PERMISSIONS } from "@/constants";

/**
 * Stream a verification document to an administrator.
 *
 * Documents live outside the public directory and are only ever served here,
 * behind an authenticated, permissioned, audited request (§16, §35).
 */
export const GET = routeHandler(
  async ({ user, params }) => {
    const { buffer, contentType, fileName } = await readVerificationDocument(params.id, user);
    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        // `fileName` is sanitised by the service; quoting it here as well
        // keeps the header well-formed for a name containing a semicolon.
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        // The bytes are identity paperwork an administrator opens in their
        // own browser. These say: render it as the type we determined from
        // the bytes, do not sniff it into something executable, and do not
        // let it reach out to anything (§35).
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  },
  { permission: PERMISSIONS.ADMIN_VERIFICATION_MANAGE, paramsSchema: z.object({ id: objectId }) },
);
