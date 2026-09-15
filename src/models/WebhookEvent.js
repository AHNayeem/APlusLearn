import mongoose from "mongoose";

/**
 * Received provider webhooks (§20, §38).
 *
 * Providers guarantee *at least once* delivery: the same event arrives again
 * after a timeout, a retry or an endpoint replay. This collection is what
 * makes that harmless. The unique `(provider, eventId)` index is the lock —
 * the first delivery inserts the row and does the work, every later delivery
 * collides on the index and is acknowledged without touching booking or
 * payment state.
 *
 * Only the envelope is kept: identifiers, type and outcome. Card details,
 * customer PII and raw provider payloads are not stored (§35).
 */
const WebhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, default: "STRIPE" },
    /** The provider's own event id. Unique per provider — this is the guard. */
    eventId: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true, index: true },

    status: {
      type: String,
      enum: ["PROCESSING", "PROCESSED", "IGNORED", "FAILED"],
      default: "PROCESSING",
      index: true,
    },

    /** What the event resolved to, for support and reconciliation. */
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Payout" },
    /** The provider object the event was about, e.g. a payment intent id. */
    providerObjectId: { type: String, trim: true, index: true },

    livemode: { type: Boolean, default: false },
    /** Short, non-sensitive note: which branch ran, or why it was ignored. */
    result: { type: String, trim: true, maxlength: 500 },
    attempts: { type: Number, default: 1 },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
WebhookEventSchema.index({ createdAt: -1 });

export const WebhookEvent =
  mongoose.models.WebhookEvent || mongoose.model("WebhookEvent", WebhookEventSchema);
