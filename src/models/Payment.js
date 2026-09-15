import mongoose from "mongoose";
import { PAYMENT_STATUS, PAYOUT_STATUS } from "../constants/index.js";
const RefundSchema = new mongoose.Schema(
  {
    amountCents: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true },
    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    providerRefundId: { type: String, trim: true },
  },
  { _id: true },
);

const PaymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    purchaserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /** Mirrors Booking.price; amounts are authoritative and server-calculated. */
    subtotalCents: { type: Number, required: true, min: 0 },
    commissionPercent: { type: Number, required: true },
    commissionCents: { type: Number, required: true, min: 0 },
    tutorEarningsCents: { type: Number, required: true, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "CAD" },

    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.REQUIRES_PAYMENT,
      index: true,
    },

    /** Provider-agnostic references — filled by whichever PaymentProvider runs. */
    provider: { type: String, default: "MOCK" },
    providerCheckoutId: { type: String, trim: true, index: true },
    providerPaymentIntentId: { type: String, trim: true, index: true },
    /** The settled charge, needed to reconcile a refund back to a payout. */
    providerChargeId: { type: String, trim: true },
    /**
     * Hosted checkout only. The provider's payment page for this payment, and
     * when that page stops working — a stale session is rebuilt rather than
     * shown. Not a secret: it is single-purpose and scoped to this payment.
     */
    providerCheckoutUrl: { type: String, trim: true },
    checkoutExpiresAt: { type: Date },
    /** Bumped each time a lapsed session is rebuilt; keys the idempotency. */
    checkoutAttempts: { type: Number, default: 0 },
    /** False for a test-mode charge. Set from the provider, never from config. */
    livemode: { type: Boolean, default: false },
    /** Last four digits only. Full instrument data never touches our database. */
    paymentMethodBrand: { type: String, trim: true },
    paymentMethodLast4: { type: String, trim: true, maxlength: 4 },

    paidAt: { type: Date },
    failureReason: { type: String, trim: true },

    refunds: { type: [RefundSchema], default: [] },
    refundedCents: { type: Number, default: 0, min: 0 },

    receiptNumber: { type: String, trim: true, index: true },
  },
  { timestamps: true },
);

PaymentSchema.index({ purchaserId: 1, createdAt: -1 });
PaymentSchema.index({ status: 1, paidAt: -1 });

export const Payment = mongoose.models.Payment || mongoose.model("Payment", PaymentSchema);

/**
 * Tutor payout account state. Modelled after Stripe Connect so swapping the
 * mock provider for the real one is a service-layer change only (§20, §38).
 */
const PayoutAccountSchema = new mongoose.Schema(
  {
    tutorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    provider: { type: String, default: "MOCK" },
    providerAccountId: { type: String, trim: true, index: true },
    onboardingStatus: {
      type: String,
      enum: ["NOT_STARTED", "IN_PROGRESS", "RESTRICTED", "COMPLETE"],
      default: "NOT_STARTED",
      index: true,
    },
    payoutsEnabled: { type: Boolean, default: false },
    chargesEnabled: { type: Boolean, default: false },
    /** Display-only masked account details. */
    bankName: { type: String, trim: true },
    accountLast4: { type: String, trim: true, maxlength: 4 },
    country: { type: String, default: "CA" },
    currency: { type: String, default: "CAD" },
    requirementsDue: { type: [String], default: [] },
    /** The provider's own reason for withholding payouts, shown to the tutor. */
    disabledReason: { type: String, trim: true },
    detailsSubmitted: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

export const PayoutAccount =
  mongoose.models.PayoutAccount || mongoose.model("PayoutAccount", PayoutAccountSchema);

const PayoutSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorProfile", index: true },

    /** The completed, held-past-hold-period bookings this payout settles. */
    bookingIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }],
    lessonCount: { type: Number, default: 0 },

    grossCents: { type: Number, required: true, min: 0 },
    commissionCents: { type: Number, required: true, min: 0 },
    amountCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "CAD" },

    status: {
      type: String,
      enum: Object.values(PAYOUT_STATUS),
      default: PAYOUT_STATUS.PENDING,
      index: true,
    },

    periodStart: { type: Date },
    periodEnd: { type: Date },
    scheduledFor: { type: Date },
    paidAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    providerTransferId: { type: String, trim: true, index: true },
    failureReason: { type: String, trim: true },
  },
  { timestamps: true },
);

PayoutSchema.index({ tutorUserId: 1, createdAt: -1 });
PayoutSchema.index({ status: 1, scheduledFor: 1 });

export const Payout = mongoose.models.Payout || mongoose.model("Payout", PayoutSchema);
