import { routeHandler, created, ValidationError } from "@/lib/api";
import { readBoundedFormData } from "@/lib/security/upload-size";
import { uploadVerificationDocument } from "@/services/verification.service";
import { VERIFICATION_TYPES, ROLES, UPLOAD } from "@/constants";

/**
 * Multipart upload of a verification document. Handled directly rather than
 * through a zod body schema because the payload is a FormData file (§16).
 *
 * Works from the first step of the application, not only after submission:
 * the service files the document against the applicant's own application
 * when no profile exists yet (R13.11). The body is read through a counted,
 * capped reader, so an oversized request is refused before it is buffered
 * (S19); the service still checks the file itself.
 */
export const POST = routeHandler(
  async ({ request, user }) => {
    const form = await readBoundedFormData(
      request,
      UPLOAD.maxDocumentBytes,
      `Documents must be smaller than ${Math.round(UPLOAD.maxDocumentBytes / 1024 / 1024)} MB.`,
    );
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

    const referenceNumber = form.get("referenceNumber");
    const document = await uploadVerificationDocument(
      {
        type,
        file,
        referenceNumber:
          typeof referenceNumber === "string" && referenceNumber.trim()
            ? referenceNumber.trim().slice(0, 60)
            : undefined,
      },
      user,
    );
    return created({ document });
  },
  { roles: ROLES.TUTOR },
);
