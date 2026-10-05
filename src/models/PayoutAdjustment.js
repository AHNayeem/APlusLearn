import mongoose from "mongoose";
import { PAYOUT_ADJUSTMENT_STATUS } from "../constants/index.js";

/**
 * A correction to what a tutor is owed, carried to their next payout
 * (S3, R16.4).
 *
 * The case it exists for: a lesson is paid out, and *afterwards* part of it is
 * refunded — a dispute decided late, an administrator's refund. The tutor was
 * paid a share of money the family has since been given back. Clawing it back
 * from a bank account is not something the platform can do, and quietly
 * absorbing it would leave the payout record describing money that did not
 * move that way. So the difference is written down here, against the lesson
 * and the payout that paid it, and deducted — visibly — from the next payout.
 *
 * `amountCents` is signed: positive is deducted from the tutor, negative is
 * owed back to them (a payout that later failed after one of its deductions
 * was raised). An adjustment is applied to exactly one payout; when a payout
 * can only absorb part of one, the remainder is split into a new OPEN row, so
 * every row is either wholly applied or wholly pending.
 */
const PayoutAdjustmentSchema = new mongoose.Schema(
  {
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", index: true },
    /** The payout that had already paid the lesson when the refund arrived. */
    sourcePayoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Payout", index: true },
    amountCents: { type: Number, required: true },
    reason: { type: String, trim: true, maxlength: 600 },
    status: {
      type: String,
      enum: Object.values(PAYOUT_ADJUSTMENT_STATUS),
      default: PAYOUT_ADJUSTMENT_STATUS.OPEN,
      index: true,
    },
    /** The payout this adjustment was deducted from (or added to). */
    appliedPayoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Payout", index: true },
    appliedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// The payout run reads a tutor's open adjustments oldest-first.
PayoutAdjustmentSchema.index({ tutorUserId: 1, status: 1, createdAt: 1 });

export const PayoutAdjustment =
  mongoose.models.PayoutAdjustment || mongoose.model("PayoutAdjustment", PayoutAdjustmentSchema);
