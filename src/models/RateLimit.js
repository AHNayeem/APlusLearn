import mongoose from "mongoose";

/**
 * One fixed rate-limit window for one caller (§36).
 *
 * Kept in MongoDB rather than in process memory because the limit is a
 * property of the *deployment*, not of whichever instance a request happened
 * to reach: five login attempts behind four servers must still be five
 * attempts. This is the shared store the architecture already has, so the
 * guarantee costs no new infrastructure — see `lib/security/rate-limit.js`
 * for when it is used and what happens if it cannot be reached.
 *
 * The `_id` is the caller's key, so incrementing a window is a single
 * conditional upsert against the index every collection already has.
 *
 * Expired rows are removed two ways, deliberately. The TTL index is the tidy
 * one, but index creation is disabled in production (`autoIndex: false`), so
 * a deployment that has never run the index build would otherwise grow this
 * collection forever. The limiter therefore also sweeps opportunistically,
 * which needs nothing to have been set up.
 */
const RateLimitWindowSchema = new mongoose.Schema(
  {
    _id: { type: String },
    count: { type: Number, default: 0 },
    resetAt: { type: Date, required: true },
  },
  { versionKey: false },
);

RateLimitWindowSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimitWindow =
  mongoose.models.RateLimitWindow || mongoose.model("RateLimitWindow", RateLimitWindowSchema);
