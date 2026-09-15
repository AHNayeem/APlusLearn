import mongoose from "mongoose";

export const AUTH_TOKEN_PURPOSE = {
  EMAIL_VERIFICATION: "EMAIL_VERIFICATION",
  PASSWORD_RESET: "PASSWORD_RESET",
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
  },
  { timestamps: true },
);

// MongoDB reaps expired tokens automatically.
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthTokenSchema.index({ userId: 1, purpose: 1, consumedAt: 1 });

export const AuthToken = mongoose.models.AuthToken || mongoose.model("AuthToken", AuthTokenSchema);
export default AuthToken;
