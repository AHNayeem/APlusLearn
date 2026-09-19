import mongoose from "mongoose";

export const AUTH_TOKEN_PURPOSE = {
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
  /** Six-digit code texted to a mobile number before it is trusted (§41 Phase 2). */
  PHONE_VERIFICATION: "PHONE_VERIFICATION",
};

/**
 * Single-use tokens for email verification and password reset.
 * Only the SHA-256 hash is stored, so a database leak cannot be replayed.
 */
const AuthTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: { type: String, enum: Object.values(AUTH_TOKEN_PURPOSE), required: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    requestedIp: { type: String },
    /**
     * What the token was issued *for*, when that is not the account itself —
     * the mobile number a phone-verification code was sent to. Confirming a
     * code proves the holder of that number, so the number is bound to the
     * token rather than read back from a request that could name another.
     */
    subject: { type: String, trim: true },
    /** Wrong guesses so far. A code is burned after a handful (§36). */
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// MongoDB reaps expired tokens automatically.
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthTokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

export const AuthToken = mongoose.models.AuthToken || mongoose.model("AuthToken", AuthTokenSchema);
export default AuthToken;
