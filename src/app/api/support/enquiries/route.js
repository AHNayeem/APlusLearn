import { routeHandler, ok } from "@/lib/api";
import { supportEnquirySchema } from "@/lib/validation/support";
import { submitSupportEnquiry } from "@/services/support.service";
import { enforceRateLimit, clientKey } from "@/lib/security/rate-limit";

/**
 * Send a message to the support inbox (§36).
 *
 * Public by design — the floating launcher is on every page, and a family that
 * cannot sign in is exactly the one that most needs to reach a human. The
 * handler stays thin: the limit is the only thing it decides, because it is the
 * one rule that belongs to the transport rather than to the enquiry.
 *
 * `user` is passed through rather than trusted from the body; the service reads
 * the enquirer's identity from it whenever somebody is signed in.
 */
export const POST = routeHandler(
  async ({ request, body, user }) => {
    // Generous enough for a person who mistypes their address and tries again,
    // tight enough that the support inbox cannot be used as a mailing list.
    enforceRateLimit(clientKey(request, "support-enquiry"), { limit: 4, windowMs: 15 * 60_000 });

    return ok(await submitSupportEnquiry(body, { user }));
  },
  { bodySchema: supportEnquirySchema },
);
