import { routeHandler, created, ValidationError } from "@/lib/api";
import { messageAttachmentSchema } from "@/lib/validation/engagement";
import { sendMessage } from "@/services/message.service";
import { attachmentsFromForm, ATTACHMENT_LIMITS } from "@/services/attachment.service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { PERMISSIONS, FEATURES } from "@/constants";

/**
 * Send a message carrying files (§21, §41 Phase 3).
 *
 * Its own endpoint rather than a second mode of `POST /api/messages`, because
 * the payload is `FormData` and the options on `routeHandler` *are* an
 * endpoint's contract — an endpoint that validated its body one way for JSON
 * and another way for multipart would not have one. The contract here is the
 * same in every other respect: same feature switch, same authentication, and
 * the same service, so the thread's rules about blocking, unread counts and
 * response times are applied once and in one place.
 *
 * Nothing about the files is decided here. Size, format, count and the
 * agreement between a file's bytes and its claimed type all belong to the
 * service, because a check written in a route is a check the next caller
 * skips.
 */
export const POST = routeHandler(
  async ({ request, user }) => {
    const form = await request.formData();
    const files = attachmentsFromForm(form);

    if (!files.length) {
      throw new ValidationError({ fieldErrors: { file: ["Choose a file to attach."] } });
    }

    const parsed = messageAttachmentSchema.safeParse({
      conversationId: form.get("conversationId") || undefined,
      tutorProfileId: form.get("tutorProfileId") || undefined,
      bookingId: form.get("bookingId") || undefined,
      requestId: form.get("requestId") || undefined,
      body: form.get("body") ?? "",
    });
    if (!parsed.success) {
      throw new ValidationError({ fieldErrors: parsed.error.flatten().fieldErrors });
    }

    // Keyed to the account rather than the address: an upload costs storage
    // that is billed to this platform, and a signed-in member is exactly who
    // we can hold to a number. Generous for somebody sending a set of photos
    // of a worksheet, far short of a way to fill a bucket.
    await enforceRateLimit(`message-attachment:${user.id}`, {
      limit: ATTACHMENT_LIMITS.maxPerMessage * 5,
      windowMs: 10 * 60_000,
    });

    return created(await sendMessage({ ...parsed.data, files }, user));
  },
  {
    // Deliberately identical to `POST /api/messages`. Attaching a file is not
    // a lesser act than typing, so it is not held to a lesser contract.
    feature: FEATURES.MESSAGING,
    permission: PERMISSIONS.MESSAGE_SEND,
    verifiedEmail: true,
  },
);
