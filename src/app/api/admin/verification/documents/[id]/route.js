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
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  },
  { permission: PERMISSIONS.ADMIN_VERIFICATION_MANAGE, paramsSchema: z.object({ id: objectId }) },
);
