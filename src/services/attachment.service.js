import "server-only";
import { UPLOAD } from "@/constants";
import { BusinessRuleError, NotFoundError, ValidationError } from "@/lib/api/errors";
import {
  inspectDocument,
  safeFileName,
  documentExtensionFor,
  describeDocumentTypes,
} from "@/lib/images/inspect";
import {
  STORAGE_SCOPES,
  getStorageProvider,
  getStorageProviderForRead,
} from "./external/storage-provider";

/**
 * Shared files (§21, §41 Phase 3).
 *
 * Everything about an attachment that is the same wherever it hangs lives
 * here: what a file has to be to be accepted, how the bytes get into the
 * store, how they come back out, and how a failed write is cleaned up. What
 * is *not* here is who may read one — that is a question about the message or
 * the report the file belongs to, and it is answered by the service that owns
 * that document, against the document as loaded from the database.
 *
 * That split is the design. One implementation of "is this a file we accept",
 * so a second upload surface cannot quietly accept a wider set; and no
 * implementation at all of "may you see it", so a second upload surface
 * cannot accidentally inherit somebody else's idea of who the audience is.
 *
 * Three rules hold for every attachment, and this module is where they hold:
 *
 *   **The format is read, never believed.** `file.type` is a string the
 *   browser sent. The stored content type is what `inspectDocument()` found
 *   in the first few bytes, and a file whose contents disagree with its claim
 *   is refused rather than stored — because the thing that refuses to render
 *   it later is somebody else's browser, and by then it is already hosted on
 *   this domain.
 *
 *   **The key never leaves the server.** `put()` returns a UUID that
 *   addresses the object; it goes into a `select: false` field and comes back
 *   out only in this module. Nothing returns it to a caller, and nothing that
 *   reaches a client has ever held one.
 *
 *   **A file nobody points at is deleted.** Uploading happens before the
 *   document that will own the file exists, so a validation failure or a lost
 *   race leaves bytes in the store with no row naming them. Every caller
 *   hands those to `discardAttachments()` on the way out.
 */

/** What every upload surface accepts. One list, not one per route. */
export const ATTACHMENT_LIMITS = {
  maxBytes: UPLOAD.maxAttachmentBytes,
  acceptedTypes: UPLOAD.acceptedAttachmentTypes,
  maxPerMessage: UPLOAD.maxAttachmentsPerMessage,
  maxPerReport: UPLOAD.maxAttachmentsPerReport,
};

/**
 * Pull the files out of a multipart form.
 *
 * Both upload routes read `file` — repeated, because that is how a multiple
 * file input posts. A string-valued entry is somebody sending a field named
 * `file` that is not one, and is dropped rather than coerced.
 */
export function attachmentsFromForm(form, field = "file") {
  return form.getAll(field).filter((entry) => entry && typeof entry !== "string");
}

/**
 * Validate one uploaded file and put it in the store.
 *
 * Returns the sub-document an attachment array wants — including the storage
 * key, which the caller writes straight into a `select: false` field and does
 * not otherwise touch.
 *
 * @param {File}   file    a web File from `request.formData()`
 * @param {object} actor   the session user; the uploader is taken from here
 * @param {string} [label] what to call the file if it arrives unnamed
 */
export async function storeAttachment(file, actor, { label = "attachment" } = {}) {
  if (!file || typeof file === "string") {
    throw new ValidationError({ fieldErrors: { file: ["Choose a file to attach."] } });
  }

  // Size is checked against the declared length first, so an oversized upload
  // is refused before it is read into memory rather than after.
  if (file.size > ATTACHMENT_LIMITS.maxBytes) {
    throw new BusinessRuleError(
      `Attachments must be smaller than ${Math.round(ATTACHMENT_LIMITS.maxBytes / 1024 / 1024)} MB.`,
      "FILE_TOO_LARGE",
    );
  }
  if (file.size === 0) {
    throw new BusinessRuleError("That file is empty.", "UNSUPPORTED_FILE_TYPE");
  }
  if (!ATTACHMENT_LIMITS.acceptedTypes.includes(file.type)) {
    throw new BusinessRuleError(
      `Attach ${describeDocumentTypes(ATTACHMENT_LIMITS.acceptedTypes)} file.`,
      "UNSUPPORTED_FILE_TYPE",
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The declared length is a claim too. A body larger than the limit that
  // announced itself as smaller is refused here, where the real size is known.
  if (buffer.length > ATTACHMENT_LIMITS.maxBytes) {
    throw new BusinessRuleError(
      `Attachments must be smaller than ${Math.round(ATTACHMENT_LIMITS.maxBytes / 1024 / 1024)} MB.`,
      "FILE_TOO_LARGE",
    );
  }

  const contentType = inspectDocument(buffer);
  if (!contentType || !ATTACHMENT_LIMITS.acceptedTypes.includes(contentType)) {
    throw new BusinessRuleError(
      `That file is not ${describeDocumentTypes(ATTACHMENT_LIMITS.acceptedTypes)}. Attach it in one of those formats.`,
      "UNSUPPORTED_FILE_TYPE",
    );
  }
  if (contentType !== file.type) {
    throw new BusinessRuleError(
      "That file's contents do not match the type it claims to be.",
      "UNSUPPORTED_FILE_TYPE",
    );
  }

  const fileName = safeFileName(file.name, label);

  const stored = await (await getStorageProvider()).put({
    buffer,
    fileName,
    contentType,
    // Derived from the *verified* type, never from the uploader's filename:
    // the key is a name this application writes to disk, and the only part of
    // it a caller could otherwise influence is the extension.
    extension: documentExtensionFor(contentType),
    scope: STORAGE_SCOPES.ATTACHMENTS,
  });

  return {
    fileName,
    contentType: stored.contentType ?? contentType,
    sizeBytes: stored.sizeBytes ?? buffer.length,
    storageKey: stored.storageKey,
    checksum: stored.checksum,
    uploadedById: actor.id,
    uploadedAt: new Date(),
  };
}

/**
 * Store several files, or none of them.
 *
 * A message with two attachments where the second is a renamed executable is
 * not a message with one attachment — it is a refused upload. So a failure
 * part-way through takes the ones already written back out before it
 * rethrows, and the caller is never handed a partial set to reason about.
 */
export async function storeAttachments(files, actor, { max, label } = {}) {
  if (!files?.length) return [];
  if (max && files.length > max) {
    throw new BusinessRuleError(
      `You can attach at most ${max} file${max === 1 ? "" : "s"} at a time.`,
      "TOO_MANY_ATTACHMENTS",
    );
  }

  const stored = [];
  try {
    for (const file of files) {
      stored.push(await storeAttachment(file, actor, { label }));
    }
  } catch (error) {
    await discardAttachments(stored);
    throw error;
  }
  return stored;
}

/**
 * Remove bytes nothing points at any more.
 *
 * Best-effort on purpose, and never throws: it runs on the failure path of an
 * upload and on the deletion of an attachment, and in both cases the outcome
 * the caller cares about has already been decided. An object that survives is
 * an orphan in a private bucket; an exception here would turn a handled error
 * into a 500, or a successful delete into an apparent failure.
 */
export async function discardAttachments(attachments) {
  if (!attachments?.length) return;
  const provider = await getStorageProvider().catch(() => null);
  if (!provider) return;

  await Promise.all(
    attachments.map(async (attachment) => {
      const key = attachment?.storageKey;
      if (!key) return;
      try {
        await provider.remove({ storageKey: key, scope: STORAGE_SCOPES.ATTACHMENTS });
      } catch {
        // Already gone, or the store is unreachable. Neither changes what the
        // caller is in the middle of doing.
      }
    }),
  );
}

/**
 * Read one attachment's bytes back.
 *
 * Takes the attachment sub-document — which means the caller has already
 * loaded the parent and decided that this person may have it. There is no
 * variant of this function that takes a key.
 *
 * Reads go through `getStorageProviderForRead()`: switching the storage
 * module off stops new uploads and deliberately does not stop retrieval, for
 * the reason written beside that factory.
 */
export async function readAttachmentBytes(attachment) {
  if (!attachment?.storageKey) throw new NotFoundError("That file is no longer available.");

  const provider = await getStorageProviderForRead();
  const buffer = await provider.get({
    storageKey: attachment.storageKey,
    scope: STORAGE_SCOPES.ATTACHMENTS,
  });

  return {
    buffer,
    contentType: attachment.contentType,
    fileName: safeFileName(attachment.fileName, "attachment"),
  };
}

/**
 * The headers a shared file is served under.
 *
 * The same posture the verification-document route uses, and for the same
 * reason: these are bytes one member of the public uploaded and another is
 * about to open in their browser.
 *
 *   `attachment` rather than `inline` — a PDF a stranger uploaded should be
 *   downloaded and opened by something that is not the tab holding this
 *   person's session. Images are the exception: a photo of a homework
 *   question is meant to appear in the thread, and it is rendered from an
 *   `<img>` where the sandbox below applies.
 *   `nosniff` — serve it as what the bytes proved to be, or not at all.
 *   `sandbox` with `default-src 'none'` — nothing this file contains may
 *   fetch, script, or navigate.
 *   `no-store` — a shared file is private to two people, and a cache in
 *   between is a third.
 */
export function attachmentHeaders({ contentType, fileName, sizeBytes }) {
  const renderInline = contentType?.startsWith("image/");
  return {
    "Content-Type": contentType,
    ...(sizeBytes ? { "Content-Length": String(sizeBytes) } : {}),
    "Content-Disposition": `${renderInline ? "inline" : "attachment"}; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  };
}
