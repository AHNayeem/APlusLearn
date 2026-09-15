import mongoose from "mongoose";
import { ROLES, USER_STATUS, AUTH_PROVIDERS, NOTIFICATION_CHANNELS } from "../constants/index.js";
const OAuthAccountSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: Object.values(AUTH_PROVIDERS), required: true },
    providerAccountId: { type: String, required: true },
    linkedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const NotificationPreferenceSchema = new mongoose.Schema(
  {
    // Channel -> enabled. Email/SMS/push are architecturally ready but the
    // MVP only delivers IN_APP (§28).
    [NOTIFICATION_CHANNELS.IN_APP]: { type: Boolean, default: true },
    [NOTIFICATION_CHANNELS.EMAIL]: { type: Boolean, default: true },
    [NOTIFICATION_CHANNELS.SMS]: { type: Boolean, default: false },
    [NOTIFICATION_CHANNELS.PUSH]: { type: Boolean, default: false },
  },
  { _id: false },
);

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    // Absent for OAuth-only accounts. Never selected by default.
    passwordHash: { type: String, select: false },

    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, trim: true, maxlength: 30 },
    avatarUrl: { type: String, trim: true },

    role: { type: String, enum: Object.values(ROLES), required: true, index: true },
    status: {
      type: String,
      enum: Object.values(USER_STATUS),
      default: USER_STATUS.PENDING_VERIFICATION,
      index: true,
    },

    emailVerifiedAt: { type: Date, default: null },

    /**
     * Bumped on password reset / forced logout. Sessions carrying an older
     * value are rejected, which gives us revocation without a session table.
     */
    tokenVersion: { type: Number, default: 0 },

    oauthAccounts: { type: [OAuthAccountSchema], default: [] },

    timeZone: { type: String, default: "America/Toronto" },

    // Coarse location used for distance search and local relevance. Exact
    // street addresses are never stored on the public user record (§15).
    city: { type: String, trim: true },
    province: { type: String, trim: true, uppercase: true },
    postalCode: { type: String, trim: true, uppercase: true },
    location: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },

    notificationPreferences: { type: NotificationPreferenceSchema, default: () => ({}) },

    marketingOptIn: { type: Boolean, default: false },
    acceptedTermsAt: { type: Date },

    lastLoginAt: { type: Date },

    // Soft-delete support for the data retention policy (§35).
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UserSchema.index({ location: "2dsphere" }, { sparse: true });
UserSchema.index({ role: 1, status: 1, createdAt: -1 });
UserSchema.index({ "oauthAccounts.provider": 1, "oauthAccounts.providerAccountId": 1 });

UserSchema.virtual("fullName").get(function fullName() {
  return `${this.firstName} ${this.lastName}`.trim();
});

UserSchema.set("toObject", { virtuals: true });
UserSchema.set("toJSON", { virtuals: true });

export const User = mongoose.models.User || mongoose.model("User", UserSchema);
export default User;
