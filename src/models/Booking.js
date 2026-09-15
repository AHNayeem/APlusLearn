import mongoose from "mongoose";
import {
  BOOKING_STATUS,
  LESSON_MODES,
  MEETING_PROVIDERS,
  IN_PERSON_LOCATIONS,
  RECURRENCE,
} from "../constants/index.js";
/**
 * Every money figure the platform commits to, in cents, calculated
 * server-side only (§20, §42). Stored on the booking so a later change to the
 * commission rate never rewrites history.
 */
const PriceBreakdownSchema = new mongoose.Schema(
  {
    hourlyRateCents: { type: Number, required: true, min: 0 },
    durationMinutes: { type: Number, required: true, min: 1 },
    subtotalCents: { type: Number, required: true, min: 0 },
    /** Commission rate captured at booking time. */
    commissionPercent: { type: Number, required: true, min: 0, max: 100 },
    commissionCents: { type: Number, required: true, min: 0 },
    tutorEarningsCents: { type: Number, required: true, min: 0 },
    totalCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "CAD" },
  },
  { _id: false },
);

const MeetingSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: Object.values(MEETING_PROVIDERS) },
    joinUrl: { type: String, trim: true },
    meetingId: { type: String, trim: true },
    passcode: { type: String, trim: true },
    createdAt: { type: Date },
  },
  { _id: false },
);

/**
 * In-person location. `addressLine` is select:false and only ever released to
 * the two parties on a confirmed booking — never on a public page (§27, §42).
 */
const LessonLocationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(IN_PERSON_LOCATIONS) },
    label: { type: String, trim: true }, // "Toronto Reference Library"
    addressLine: { type: String, trim: true, select: false },
    city: { type: String, trim: true },
    postalCode: { type: String, trim: true, uppercase: true },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const CancellationSchema = new mongoose.Schema(
  {
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancelledByRole: { type: String },
    reason: { type: String, trim: true, maxlength: 600 },
    hoursBeforeStart: { type: Number },
    /** Outcome of the centralised refund policy (§26). */
    refundPercent: { type: Number, min: 0, max: 100 },
    refundCents: { type: Number, min: 0 },
    policyApplied: { type: String },
  },
  { _id: false },
);

const BookingSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true }, // APL-7F3K2Q

    /** The paying account. */
    purchaserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** The learner attending. */
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

    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    /** Denormalised so lesson lists render without a join. */
    courseName: { type: String, trim: true },
    courseCode: { type: String, uppercase: true, trim: true },
    subjectName: { type: String, trim: true },

    mode: { type: String, enum: Object.values(LESSON_MODES), required: true },
    meeting: { type: MeetingSchema, default: undefined },
    location: { type: LessonLocationSchema, default: undefined },

    /** UTC instants; `timeZone` is the tutor's zone for display. */
    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 15 },
    timeZone: { type: String, default: "America/Toronto" },

    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.PENDING_PAYMENT,
      index: true,
    },

    price: { type: PriceBreakdownSchema, required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Payout", index: true },

    /** Recurring series link. The first booking is its own series parent. */
    recurrence: { type: String, enum: Object.values(RECURRENCE), default: RECURRENCE.NONE },
    seriesId: { type: mongoose.Schema.Types.ObjectId, index: true },
    seriesIndex: { type: Number, default: 0 },

    studentNotes: { type: String, trim: true, maxlength: 1000 },
    tutorNotes: { type: String, trim: true, maxlength: 2000, select: false },

    confirmedAt: { type: Date },
    completedAt: { type: Date },
    cancellation: { type: CancellationSchema, default: undefined },

    /** Set once a review exists, so "leave a review" prompts disappear. */
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: "Review" },
    remindersSent: { type: [String], default: [] },
  },
  { timestamps: true },
);

// Double-booking check and tutor calendar both read this index (§18, §42).
BookingSchema.index({ tutorProfileId: 1, startAt: 1, status: 1 });
BookingSchema.index({ purchaserId: 1, startAt: -1 });
BookingSchema.index({ studentProfileId: 1, startAt: -1 });
BookingSchema.index({ status: 1, startAt: 1 });
BookingSchema.index({ tutorUserId: 1, status: 1, completedAt: -1 });

export const Booking = mongoose.models.Booking || mongoose.model("Booking", BookingSchema);
export default Booking;
