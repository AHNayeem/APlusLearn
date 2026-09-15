import { routeHandler, created, ValidationError } from "@/lib/api";
import { uploadVerificationDocument } from "@/services/verification.service";
import { VERIFICATION_TYPES, ROLES } from "@/constants";

/**
 * Multipart upload of a verification document. Handled directly rather than
 * through a zod body schema because the payload is a FormData file (§16).
 */
export const POST = routeHandler(
  async ({ request, user }) => {
    const form = await request.formData();
    const type = form.get("type");
    const file = form.get("file");

    const errors = {};
    if (!Object.values(VERIFICATION_TYPES).includes(type)) {
      errors.type = ["Choose which badge this document supports."];
    }
    if (!file || typeof file === "string") {
      errors.file = ["Attach a document."];
    }
    if (Object.keys(errors).length) throw new ValidationError({ fieldErrors: errors });

    const document = await uploadVerificationDocument(
      { type, file, referenceNumber: form.get("referenceNumber") || undefined },
      user,
    );
    return created({ document });
  },
  { roles: ROLES.TUTOR },
);
