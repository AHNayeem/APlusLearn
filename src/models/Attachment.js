import mongoose from "mongoose";

/**
 * A file one member of the platform shared with another (§21, §41 Phase 3).
 *
 * This is a *sub-document schema*, not a collection, and that is the whole
 * design decision. An attachment has no life of its own: it exists because a
 * message was sent or a progress report was written, and the document it
 * hangs off is the same document that says who may read it. Keeping it inline
 * means the authorization check and the file are loaded together, so there is
 * no second place where "may this person see this?" could be answered
 * differently — and no orphan row pointing at bytes whose audience nobody
 * remembers.
 *
 * `Message.attachments` was declared with these first four fields long before
 * anything populated it. They are kept exactly as they were so nothing has to
 * migrate; the rest are additions.
 *
 * `storageKey` is `select: false`.
 *
 * That is not decoration. The key is the one value that addresses the bytes
 * in the object store, and every other field here is designed to be shown to
 * somebody. A message is serialised to a browser on every page of every
 * thread, so a key that came along by default would be one `JSON.stringify`
 * from the client — and the storage provider cannot tell a key that leaked
 * from a key that was issued. Readers ask for the attachment *by id* through
 * a route that checks the parent document; nothing client-side ever learns
 * where the file actually lives.
 */
export const AttachmentSchema = new mongoose.Schema(
  {
    /** The uploader's filename, sanitised. A label — never a path. */
    fileName: { type: String, required: true, trim: true, maxlength: 140 },
    /** What the *bytes* proved to be, not what the browser claimed. */
    contentType: { type: String, required: true, trim: true },
    sizeBytes: { type: Number, required: true, min: 0 },
    storageKey: { type: String, required: true, select: false },

    /** Lets a re-upload of identical bytes be recognised as such. */
    checksum: { type: String, select: false },

    /**
     * Who uploaded it, resolved from the session at the time and never from a
     * request field. Kept here rather than inferred from the parent because a
     * progress report has one author but two readers, and "the tutor attached
     * this" has to stay true even if the report is later revised.
     */
    uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * The shape an attachment takes on its way to a browser.
 *
 * Everything a client needs to render a row and ask for the file, and nothing
 * that would let it reach the file another way. `storageKey` and `checksum`
 * are `select: false` already; stripping them here as well means a call site
 * that forgets and does `.select("+storageKey")` still cannot publish one by
 * accident.
 *
 * @param {object} attachment a lean or hydrated attachment sub-document
 * @param {string} hrefBase   the route that streams this kind of attachment
 */
export function toPublicAttachment(attachment, hrefBase) {
  if (!attachment) return null;
  const id = String(attachment._id ?? attachment.id);
  return {
    id,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    uploadedAt: attachment.uploadedAt ?? null,
    uploadedById: attachment.uploadedById ? String(attachment.uploadedById) : null,
    /** Where to ask for the bytes. The route re-checks who is asking. */
    href: `${hrefBase}/${id}`,
  };
}
