import mongoose from "mongoose";
import {
  PACKAGE_STATUS,
  PACKAGE_PURCHASE_STATUS,
  LESSON_MODES,
} from "../constants/index.js";

/**
 * A block of lessons a tutor offers at a set price (§41 Phase 2).
 *
 * This is the *offer*, not anybody's balance. Archiving one takes it off sale
 * and does nothing at all to the lessons families have already bought — those
 * live in `PackagePurchase` below, which is why the two are separate
 * documents rather than one.
 */
const TutorPackageSchema = new mongoose.Schema(
  {
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000 },

    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    courseCode: { type: String, uppercase: true, trim: true },
    courseName: { type: String, trim: true },
    subjectName: { type: String, trim: true },

    sessionCount: { type: Number, required: true, min: 1, max: 100 },
    sessionDurationMinutes: { type: Number, required: true, min: 15, max: 240 },
    mode: { type: String, enum: Object.values(LESSON_MODES), default: LESSON_MODES.ONLINE },

    /**
     * What the whole block costs. Every other money figure is derived from
     * it, so there is one number a tutor sets and one the platform computes.
     */
    priceCents: { type: Number, required: true, min: 0 },
    /** Derived and stored so search and cards sort without recomputing. */
    perSessionCents: { type: Number, required: true, min: 0 },
    effectiveHourlyRateCents: { type: Number, required: true, min: 0 },
    /** Saving against the tutor's own rate, as a percentage. Never negative. */
    savingPercent: { type: Number, default: 0, min: 0, max: 100 },

    /** How long a purchase stays usable. Null means the platform default. */
    validityDays: { type: Number, min: 1, max: 730 },

    status: {
      type: String,
      enum: Object.values(PACKAGE_STATUS),
      default: PACKAGE_STATUS.DRAFT,
      index: true,
    },

    stats: {
      purchases: { type: Number, default: 0 },
      sessionsDelivered: { type: Number, default: 0 },
      grossCents: { type: Number, default: 0 },
    },

    publishedAt: { type: Date },
    archivedAt: { type: Date },
  },
  { timestamps: true },
);

// The public list on a tutor's profile.
TutorPackageSchema.index({ tutorProfileId: 1, status: 1, createdAt: -1 });
TutorPackageSchema.index({ status: 1, courseId: 1 });

export const TutorPackage =
  mongoose.models.TutorPackage || mongoose.model("TutorPackage", TutorPackageSchema);

/**
 * A family's balance of lessons with one tutor (§41 Phase 2).
 *
 * The terms are copied in at purchase rather than read back through the
 * offer: a tutor who later raises their price must not change what somebody
 * already bought, and an archived offer must still be able to explain a
 * balance somebody is still drawing on.
 *
 * `sessionsUsed` is the consumption guard. Every draw is one conditional
 * update on this document — see `consumePackageSession` — so two bookings
 * made at the same moment cannot take the same last lesson.
 */
const PackagePurchaseSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },

    packageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorPackage",
      required: true,
      index: true,
    },
    purchaserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentProfile",
      required: true,
      index: true,
    },
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // --- Terms as they were at purchase. Never read back from the offer. ---
    title: { type: String, trim: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    courseCode: { type: String, uppercase: true, trim: true },
    courseName: { type: String, trim: true },
    mode: { type: String, enum: Object.values(LESSON_MODES) },
    sessionDurationMinutes: { type: Number, required: true, min: 15 },

    sessionsTotal: { type: Number, required: true, min: 1 },
    sessionsUsed: { type: Number, default: 0, min: 0 },

    priceCents: { type: Number, required: true, min: 0 },
    perSessionCents: { type: Number, required: true, min: 0 },
    commissionPercent: { type: Number, required: true, min: 0, max: 100 },
    /** Per session, so a cancelled lesson refunds and pays out exactly. */
    perSessionCommissionCents: { type: Number, required: true, min: 0 },
    perSessionTutorEarningsCents: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: Object.values(PACKAGE_PURCHASE_STATUS),
      default: PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT,
      index: true,
    },

    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    bookingIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }],

    activatedAt: { type: Date },
    expiresAt: { type: Date, index: true },
    /** Set once, so the "expiring soon" warning is never sent twice. */
    expiryWarnedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    refundedCents: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// The family's packages, and the tutor's view of who is holding lessons.
PackagePurchaseSchema.index({ purchaserId: 1, status: 1, createdAt: -1 });
PackagePurchaseSchema.index({ tutorUserId: 1, status: 1 });
// What the booking form asks for: a usable balance with this tutor and course.
PackagePurchaseSchema.index({ purchaserId: 1, tutorProfileId: 1, courseId: 1, status: 1 });
// The expiry sweep.
PackagePurchaseSchema.index({ status: 1, expiresAt: 1 });

/** Lessons still to draw. Derived, never stored — two fields would drift. */
PackagePurchaseSchema.virtual("sessionsRemaining").get(function remaining() {
  return Math.max(0, (this.sessionsTotal ?? 0) - (this.sessionsUsed ?? 0));
});

PackagePurchaseSchema.set("toObject", { virtuals: true });
PackagePurchaseSchema.set("toJSON", { virtuals: true });

export const PackagePurchase =
  mongoose.models.PackagePurchase || mongoose.model("PackagePurchase", PackagePurchaseSchema);
