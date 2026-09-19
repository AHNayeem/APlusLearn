import mongoose from "mongoose";
import {
  REFERRAL_STATUS,
  REFERRAL_RISK_FLAGS,
  CREDIT_REASONS,
} from "../constants/index.js";

/**
 * One person introducing another (§41 Phase 2).
 *
 * At most one referral per referee, ever — enforced by the unique index
 * below, not only by a check. That single constraint is what makes the whole
 * scheme hard to farm: an account can be introduced once, and a reward is
 * paid against a lesson that was actually taken and paid for.
 */
const ReferralSchema = new mongoose.Schema(
  {
    referrerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /**
     * Deliberately without `index: true`: the unique index is declared below,
     * and declaring both makes Mongoose skip the second definition — taking
     * the `unique` option with it and silently removing the one constraint
     * this whole scheme rests on.
     */
    refereeUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** The code as it was used, kept even if the referrer's code changes. */
    code: { type: String, required: true, uppercase: true, trim: true, index: true },

    status: {
      type: String,
      enum: Object.values(REFERRAL_STATUS),
      default: REFERRAL_STATUS.PENDING,
      index: true,
    },

    /** The lessons that made it qualify, so a refund can find it again. */
    qualifyingBookingIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }],
    qualifyingLessons: { type: Number, default: 0, min: 0 },

    /** What was actually granted, captured at the time the rules ran. */
    referrerRewardCents: { type: Number, default: 0, min: 0 },
    refereeRewardCents: { type: Number, default: 0, min: 0 },

    /**
     * Signals for a human, never an automatic penalty. The requirements
     * define no punishment, so the platform records and surfaces rather than
     * inventing one (§41 Phase 2).
     */
    riskFlags: {
      type: [String],
      enum: Object.values(REFERRAL_RISK_FLAGS),
      default: [],
      index: true,
    },

    attributedAt: { type: Date, default: Date.now },
    qualifiedAt: { type: Date },
    rewardedAt: { type: Date },
    reversedAt: { type: Date },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reversalReason: { type: String, trim: true, maxlength: 300 },

    /** Coarse signup context, for spotting a farm. Never a full address. */
    signupIpHash: { type: String, trim: true },
  },
  { timestamps: true },
);

// One attribution per account, for all time.
ReferralSchema.index({ refereeUserId: 1 }, { unique: true });
ReferralSchema.index({ referrerUserId: 1, status: 1, createdAt: -1 });
ReferralSchema.index({ status: 1, createdAt: -1 });

export const Referral = mongoose.models.Referral || mongoose.model("Referral", ReferralSchema);

/**
 * Every movement on an account's credit balance.
 *
 * The authoritative balance is `User.creditBalanceCents`, because a single
 * conditional `$inc` on one document is the only way to make "spend at most
 * what you have" safe against two concurrent checkouts without transactions.
 * This collection is the explanation of that number, and the thing a support
 * conversation is actually about.
 */
const CreditEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Positive grants, negative spends. Always in cents. */
    amountCents: { type: Number, required: true },
    reason: { type: String, enum: Object.values(CREDIT_REASONS), required: true, index: true },

    referralId: { type: mongoose.Schema.Types.ObjectId, ref: "Referral", index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },

    note: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /** The balance after this entry, so a statement reads without a running sum. */
    balanceAfterCents: { type: Number, min: 0 },

    /**
     * Makes a grant exactly-once. A referral that qualifies twice because a
     * job ran twice writes the same key and the second insert is refused.
     */
    idempotencyKey: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

CreditEntrySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
CreditEntrySchema.index({ userId: 1, createdAt: -1 });

export const CreditEntry =
  mongoose.models.CreditEntry || mongoose.model("CreditEntry", CreditEntrySchema);
