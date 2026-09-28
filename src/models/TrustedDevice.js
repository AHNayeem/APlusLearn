import mongoose from "mongoose";

/**
 * A browser that has proved, with an emailed sign-in code, that it belongs to
 * the account owner (§9, §36).
 *
 * The browser holds a random value in the `aplus_device` cookie; only its
 * SHA-256 lands here, so a copy of this collection is not a way past the step.
 * Trust is per account: one shared family laptop is trusted separately by each
 * person who verifies on it.
 *
 * `tokenVersion` is the account's session generation at the moment of trust,
 * and a device is recognised only while the two still match. So every event
 * that already ends every session — a password reset or change, "sign out
 * everywhere", a suspension — ends every device's trust with it, and no call
 * site has to remember to.
 */
const TrustedDeviceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    deviceHash: { type: String, required: true },
    tokenVersion: { type: Number, required: true },
    /** "Chrome on macOS" — for the person reading their own device list. */
    label: { type: String, trim: true, maxlength: 80 },
    userAgent: { type: String, trim: true, maxlength: 300 },
    ip: { type: String, trim: true, maxlength: 64 },
    lastUsedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

TrustedDeviceSchema.index({ userId: 1, deviceHash: 1 }, { unique: true });
// MongoDB reaps lapsed trust automatically.
TrustedDeviceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TrustedDevice =
  mongoose.models.TrustedDevice || mongoose.model("TrustedDevice", TrustedDeviceSchema);
export default TrustedDevice;
