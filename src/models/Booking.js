import mongoose from "mongoose";
import {
  BOOKING_STATUS,
  LESSON_MODES,
  MEETING_PROVIDERS,
  MEETING_SOURCES,
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

/**
 * The joining details for one online lesson (§27).
 *
 * Shared with `GroupSession`, which imports this schema rather than declaring
 * a second one, so a room is the same shape whether one learner attends or
 * twelve — and a change here cannot apply to only half the platform.
 *
 * What is deliberately *not* here: the topic, the start time, the duration,
 * the time zone and the host. Every one of those already lives on the lesson
 * this sub-document hangs off, and a second copy would be a second thing to
 * keep true through a reschedule. The adapters derive them from the lesson at
 * the moment they call the provider.
 *
 * `passcode` is a credential. It is released only by `getBooking()` /
 * `getGroupSession()`, only to people entitled to attend, and it is never
 * logged — `meeting.service` redacts it from its own audit metadata.
 */
const MeetingSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: Object.values(MEETING_PROVIDERS) },
    joinUrl: { type: String, trim: true },
    meetingId: { type: String, trim: true },
    passcode: { type: String, trim: true },
    createdAt: { type: Date },

    /**
     * Whether this application owns the room. See `MEETING_SOURCES` — it
     * decides whether a reschedule may move the room and whether a
     * cancellation may tear it down.
     */
    source: {
      type: String,
      enum: Object.values(MEETING_SOURCES),
      default: MEETING_SOURCES.PROVIDER,
    },

    /**
     * Joining instructions from the tutor — "use the waiting room, I'll let
     * you in", a dial-in note, which browser to use. Free text shown beside
     * the join button; it carries no behaviour.
     */
    instructions: { type: String, trim: true, maxlength: 500 },

    /**
     * Withdrawn from the people attending.
     *
     * This stops *this platform* handing the link out and refuses the join
     * action. It does not close the room at the provider — nothing here can
     * promise that, least of all for a MANUAL room in somebody else's
     * account. It is the reversible control ("that link got shared around,
     * stop giving it out while I sort out a new one"); clearing the meeting
     * outright is the destructive one, and only that tears a PROVIDER room
     * down.
     */
    disabled: { type: Boolean, default: false },

    /** Who last set these details by hand, and when. Null for a PROVIDER room. */
    configuredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    configuredAt: { type: Date },
  },
  { _id: false },
);

export { MeetingSchema };

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

/**
 * A lesson as it exists on somebody's external calendar (§18, §41 Phase 2).
 *
 * One entry per connection the lesson was pushed to. The pair
 * (connectionId, booking) is what makes the push idempotent: a retry finds
 * the existing entry and updates that event instead of creating a second one,
 * so a tutor never ends up with the same lesson twice in their week.
 */
const ExternalEventSchema = new mongoose.Schema(
  {
    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CalendarConnection",
      required: true,
    },
    provider: { type: String, trim: true },
    eventId: { type: String, trim: true },
    state: { type: String, trim: true },
    syncedAt: { type: Date },
    error: { type: String, trim: true, maxlength: 300 },
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
    /**
     * The platform the purchaser chose for an online lesson (§27).
     *
     * Stored as *intent* at booking time and read back when the room is
     * actually created, which happens later and on a different thread of
     * control — a verified webhook, not the browser that booked. Without it
     * the choice was silently lost and every lesson fell back to one
     * provider. `meeting.provider` below records what was really used, which
     * differs when the chosen provider is not configured on this deployment.
     */
    meetingProvider: { type: String, enum: Object.values(MEETING_PROVIDERS) },
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
    /**
     * Set when this lesson was drawn from a package rather than paid for on
     * its own (§41 Phase 2). `paymentId` still points at the package's
     * payment, so refunds and receipts resolve exactly as they always did.
     */
    packagePurchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PackagePurchase",
      index: true,
      sparse: true,
    },
    payoutId: { type: mongoose.Schema.Types.ObjectId, ref: "Payout", index: true },

    /** Recurring series link. The first booking is its own series parent. */
    recurrence: { type: String, enum: Object.values(RECURRENCE), default: RECURRENCE.NONE },
    seriesId: { type: mongoose.Schema.Types.ObjectId, index: true },
    seriesIndex: { type: Number, default: 0 },

    studentNotes: { type: String, trim: true, maxlength: 1000 },
    tutorNotes: { type: String, trim: true, maxlength: 2000, select: false },

    confirmedAt: { type: Date },
    completedAt: { type: Date },
    /** Set when an unpaid hold lapsed and the slot was released (§19). */
    expiredAt: { type: Date },
    cancellation: { type: CancellationSchema, default: undefined },

    /** Set once a review exists, so "leave a review" prompts disappear. */
    reviewId: { type: mongoose.Schema.Types.ObjectId, ref: "Review" },
    remindersSent: { type: [String], default: [] },

    /**
     * Set when this booking is one learner's place in a group session
     * (§41 Phase 2).
     *
     * The booking stays an ordinary booking — its own price, payment, status
     * and cancellation — which is what lets payouts, refunds and reviews work
     * unchanged. What it does not do is hold the tutor's slot on its own: the
     * group session reserved that once, and several bookings legitimately
     * share the same hour.
     */
    groupSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupSession",
      index: true,
      sparse: true,
    },

    /** Where this lesson has been mirrored onto an external calendar (§18). */
    externalEvents: { type: [ExternalEventSchema], default: [] },
  },
  { timestamps: true },
);

// Double-booking check and tutor calendar both read this index (§18, §42).
BookingSchema.index({ tutorProfileId: 1, startAt: 1, status: 1 });
BookingSchema.index({ purchaserId: 1, startAt: -1 });
BookingSchema.index({ studentProfileId: 1, startAt: -1 });
BookingSchema.index({ status: 1, startAt: 1 });
// The expiry sweep asks for PENDING_PAYMENT bookings oldest-first.
BookingSchema.index({ status: 1, createdAt: 1 });
BookingSchema.index({ tutorUserId: 1, status: 1, completedAt: -1 });
// Tutor analytics window by lesson date and exclude statuses rather than
// select them, so the status field cannot lead the index (§41 Phase 2).
BookingSchema.index({ tutorUserId: 1, startAt: 1 });

export const Booking = mongoose.models.Booking || mongoose.model("Booking", BookingSchema);

/**
 * One exclusive claim on a tutor's start time (§18, §42).
 *
 * MongoDB cannot express "no overlapping time range" as a unique index, so
 * overlapping lessons of *different* lengths are still settled by the
 * write-then-read tie-break in `booking.service`. What this collection does
 * is make the common case — two people taking the same offered slot at the
 * same moment — decided by the database rather than by two reads racing each
 * other: the `_id` index is unique, always present, and needs no migration or
 * `autoIndex`, so the second insert is refused outright.
 *
 * The lock is **self-healing rather than lifecycle-managed**. Nothing in the
 * cancellation, expiry, no-show or completion paths has to remember to
 * release one: a claim naming a booking that no longer holds that slot is
 * stale, and the next request for the slot takes it over atomically. That is
 * deliberate — a lock somebody must remember to free is a lock that will one
 * day wedge a tutor's calendar shut, which is a worse failure than the race
 * it was added to close.
 *
 * Group sessions do not claim: several learners legitimately share one hour,
 * and the session itself already reserved it once.
 */
const BookingSlotLockSchema = new mongoose.Schema(
  {
    /** `<tutorProfileId>:<startAt in epoch milliseconds>`. */
    _id: { type: String },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    claimedAt: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export const BookingSlotLock =
  mongoose.models.BookingSlotLock || mongoose.model("BookingSlotLock", BookingSlotLockSchema);

export default Booking;
