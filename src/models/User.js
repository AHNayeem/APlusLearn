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
    /**
     * Mobile number in E.164, and when it was proved (§41 Phase 2).
     *
     * `phone` stays as the person typed it, for display and for support.
     * `phoneE164` is the only value ever handed to an SMS provider, and a text
     * is only ever sent once `phoneVerifiedAt` is set — an unconfirmed number
     * may belong to somebody else entirely, and texting it would leak a
     * lesson time to a stranger (§36).
     */
    phoneE164: { type: String, trim: true, maxlength: 20, index: true, sparse: true },
    phoneVerifiedAt: { type: Date, default: null },
    /**
     * Set when the carrier forwards STOP. It outranks every preference,
     * including one the account holder set themselves, because honouring it
     * is a legal duty rather than a setting.
     */
    smsOptOutAt: { type: Date, default: null },
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

    /**
     * The payment provider's customer record for this purchaser. Storing it
     * keeps a returning parent's saved cards and receipts together on the
     * provider side; it holds no card data itself.
     */
    paymentCustomerId: { type: String, trim: true, index: true, sparse: true },

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

    /**
     * The code this account shares, and the balance it has earned (§41 Phase 2).
     *
     * `creditBalanceCents` is authoritative rather than derived: a single
     * conditional `$inc` on this one document is what makes "spend at most
     * what you have" safe against two checkouts racing, which a sum over a
     * ledger can never be without transactions. `CreditEntry` explains it.
     */
    referralCode: { type: String, uppercase: true, trim: true, index: true, sparse: true },
    creditBalanceCents: { type: Number, default: 0, min: 0 },

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
