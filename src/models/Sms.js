import mongoose from "mongoose";
import { SMS_STATUS, SMS_SKIP_REASONS, NOTIFICATION_TYPES } from "../constants/index.js";

/**
 * One outgoing text message, and what became of it (§28, §41 Phase 2).
 *
 * Every attempt is recorded, including the ones that were deliberately *not*
 * sent: "why did this person not get a text?" is a support question asked far
 * more often than "did it arrive?", and a skipped row with a reason answers it
 * without anyone guessing.
 *
 * What is deliberately not stored:
 *
 *   The message body in full. Texts carry lesson times, names and one-time
 *   codes; a support view does not need any of that, so only a short preview
 *   is kept and verification codes are never previewed at all (§36).
 *
 *   Anything from the provider beyond its own message id and error code. A
 *   provider's raw payload is not ours to retain.
 */
const SmsMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    /** E.164, as it was handed to the provider. */
    to: { type: String, required: true, trim: true, index: true },

    /** The notification this text belongs to, when it belongs to one. */
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", index: true },
    notificationType: { type: String, enum: Object.values(NOTIFICATION_TYPES) },
    /** Security codes are not notifications; they are labelled in their own right. */
    kind: {
      type: String,
      enum: ["NOTIFICATION", "VERIFICATION"],
      default: "NOTIFICATION",
      index: true,
    },

    bodyPreview: { type: String, trim: true, maxlength: 160 },
    segments: { type: Number, min: 0 },

    status: {
      type: String,
      enum: Object.values(SMS_STATUS),
      required: true,
      index: true,
    },
    skipReason: { type: String, enum: Object.values(SMS_SKIP_REASONS) },

    provider: { type: String, trim: true },
    providerMessageId: { type: String, trim: true, index: true },
    providerStatus: { type: String, trim: true },
    errorCode: { type: String, trim: true },
    errorMessage: { type: String, trim: true, maxlength: 300 },

    /**
     * What makes this message unique. A retried event — a webhook redelivered,
     * a job run twice — computes the same key and the unique index below turns
     * the second write into a no-op, so nobody is texted twice for one thing
     * (§41 Phase 2, idempotency).
     */
    dedupeKey: { type: String, trim: true },

    sentAt: { type: Date },
    deliveredAt: { type: Date },
  },
  { timestamps: true },
);

// The idempotency guarantee. Sparse, because a skipped row has no key.
SmsMessageSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
SmsMessageSchema.index({ createdAt: -1 });
SmsMessageSchema.index({ status: 1, createdAt: -1 });
SmsMessageSchema.index({ userId: 1, createdAt: -1 });
// The per-number send-rate check reads this shape.
SmsMessageSchema.index({ to: 1, createdAt: -1 });

export const SmsMessage =
  mongoose.models.SmsMessage || mongoose.model("SmsMessage", SmsMessageSchema);
export default SmsMessage;
