import mongoose from "mongoose";
import {
  GROUP_SESSION_STATUS,
  GROUP_ENROLMENT_STATUS,
  ATTENDANCE,
  LESSON_MODES,
  MEETING_PROVIDERS,
  IN_PERSON_LOCATIONS,
} from "../constants/index.js";
import { MeetingSchema } from "./Booking.js";

/**
 * One lesson several learners attend together (§41 Phase 2).
 *
 * The booking model is deliberately left alone. A group session is a separate
 * document because it is a different shape — one tutor, one time, many
 * learners — but every *learner's* place in it is still an ordinary `Booking`
 * with `groupSessionId` set. That is what keeps payment, payout, cancellation
 * policy, reviews and the tutor's calendar working exactly as they already do
 * without a second implementation of any of them.
 *
 * `seatsTaken` is the capacity guard. Every join is one conditional update on
 * this document, so two learners clicking at the same instant cannot both
 * take the last seat.
 */
const GroupSessionSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },

    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000 },

    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    courseCode: { type: String, uppercase: true, trim: true },
    courseName: { type: String, trim: true },
    subjectName: { type: String, trim: true },
    gradeLevel: { type: Number, index: true },
    provinceCode: { type: String, uppercase: true, index: true },

    mode: { type: String, enum: Object.values(LESSON_MODES), required: true },
    meetingProvider: { type: String, enum: Object.values(MEETING_PROVIDERS) },
    /**
     * Created once for the whole group, not once per learner.
     *
     * The same `MeetingSchema` a one-to-one booking uses, imported rather than
     * redeclared: a room is a room, and one shape means `meeting.service`
     * configures both through one code path.
     */
    meeting: { type: MeetingSchema, default: undefined },
    location: {
      type: new mongoose.Schema(
        {
          type: { type: String, enum: Object.values(IN_PERSON_LOCATIONS) },
          label: { type: String, trim: true },
          addressLine: { type: String, trim: true, select: false },
          city: { type: String, trim: true },
          postalCode: { type: String, trim: true, uppercase: true },
          notes: { type: String, trim: true, maxlength: 500 },
        },
        { _id: false },
      ),
      default: undefined,
    },

    startAt: { type: Date, required: true, index: true },
    endAt: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 15 },
    timeZone: { type: String, default: "America/Toronto" },

    minParticipants: { type: Number, required: true, min: 1, max: 100 },
    maxParticipants: { type: Number, required: true, min: 1, max: 100 },
    /** Seats held right now. The capacity guard — see the class note. */
    seatsTaken: { type: Number, default: 0, min: 0 },
    waitlistCount: { type: Number, default: 0, min: 0 },

    pricePerSeatCents: { type: Number, required: true, min: 0 },
    commissionPercent: { type: Number, required: true, min: 0, max: 100 },

    /**
     * When the minimum has to be met. A session that has not filled by then is
     * cancelled and everybody is refunded, rather than a tutor turning up for
     * one person at a group price.
     */
    confirmBy: { type: Date, index: true },

    status: {
      type: String,
      enum: Object.values(GROUP_SESSION_STATUS),
      default: GROUP_SESSION_STATUS.DRAFT,
      index: true,
    },

    publishedAt: { type: Date },
    confirmedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    /** Set once, so the "seats still free" nudge is not sent twice. */
    fillWarnedAt: { type: Date },

    tutorNotes: { type: String, trim: true, maxlength: 2000, select: false },
  },
  { timestamps: true },
);

// The public listing: sessions still open, soonest first.
GroupSessionSchema.index({ status: 1, startAt: 1 });
GroupSessionSchema.index({ status: 1, courseId: 1, startAt: 1 });
GroupSessionSchema.index({ tutorProfileId: 1, startAt: -1 });
// The confirmation sweep.
GroupSessionSchema.index({ status: 1, confirmBy: 1 });

GroupSessionSchema.virtual("seatsRemaining").get(function remaining() {
  return Math.max(0, (this.maxParticipants ?? 0) - (this.seatsTaken ?? 0));
});

GroupSessionSchema.set("toObject", { virtuals: true });
GroupSessionSchema.set("toJSON", { virtuals: true });

export const GroupSession =
  mongoose.models.GroupSession || mongoose.model("GroupSession", GroupSessionSchema);

/**
 * One learner's place in a group session.
 *
 * Carries the lifecycle that is specific to being *in a group* — waitlisting,
 * attendance — while `bookingId` points at the ordinary booking that carries
 * everything else. Nothing here duplicates a booking's money or status.
 */
const GroupEnrolmentSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupSession",
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

    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", index: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", index: true },

    status: {
      type: String,
      enum: Object.values(GROUP_ENROLMENT_STATUS),
      default: GROUP_ENROLMENT_STATUS.PENDING_PAYMENT,
      index: true,
    },

    /** Position in the queue when there was no seat. */
    waitlistPosition: { type: Number, min: 1 },

    attendance: { type: String, enum: Object.values(ATTENDANCE) },
    attendanceRecordedAt: { type: Date },
    attendanceRecordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    joinedAt: { type: Date, default: Date.now },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true, maxlength: 300 },
    refundedCents: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

/**
 * One place per learner per session, for all time.
 *
 * A unique index rather than only a check: two clicks in two tabs would
 * otherwise both pass a "have they already joined?" read and create two
 * enrolments, charging a family twice for one seat.
 */
GroupEnrolmentSchema.index({ sessionId: 1, studentProfileId: 1 }, { unique: true });
GroupEnrolmentSchema.index({ sessionId: 1, status: 1 });
GroupEnrolmentSchema.index({ purchaserId: 1, createdAt: -1 });

export const GroupEnrolment =
  mongoose.models.GroupEnrolment || mongoose.model("GroupEnrolment", GroupEnrolmentSchema);
