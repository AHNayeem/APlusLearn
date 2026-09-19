import mongoose from "mongoose";
import {
  REQUEST_STATUS,
  REQUEST_URGENCY,
  REQUEST_VISIBILITY,
  MATCH_STATUS,
  LESSON_MODES,
  QUALIFICATION_TYPES,
} from "../constants/index.js";
import { MATCH_FACTOR_KEYS } from "../lib/matching/weights.js";
import { ModerationEntrySchema } from "./Engagement.js";

/**
 * "Post a tutor request" — the reverse marketplace. A family describes what
 * they need and tutors respond (§22, §41 Phase 2).
 *
 * Every Phase 2 field below is optional with a default, so a request written
 * by the MVP build still loads, still matches and still renders: `languages`
 * and `preferredQualifications` default to empty (the scorer treats an empty
 * preference as neutral), `urgency` and `visibility` take the same values the
 * MVP behaved as if it had, and the moderation fields are simply absent until
 * a moderator touches the record.
 */
const TutorRequestSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentProfile",
      required: true,
      index: true,
    },

    /** The family's own headline for the request, shown on the tutor board. */
    title: { type: String, trim: true, maxlength: 120 },

    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true, index: true },
    courseName: { type: String, trim: true },
    courseCode: { type: String, uppercase: true, trim: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject", index: true },
    gradeLevel: { type: Number, index: true },
    provinceCode: { type: String, uppercase: true, index: true },

    modes: {
      type: [String],
      enum: Object.values(LESSON_MODES),
      default: [LESSON_MODES.ONLINE],
      index: true,
    },
    city: { type: String, trim: true, index: true },
    postalCode: { type: String, trim: true, uppercase: true },
    location: {
      type: { type: String, enum: ["Point"], default: undefined },
      coordinates: { type: [Number], default: undefined },
    },
    maxDistanceKm: { type: Number, default: 25 },

    /** Preferred windows, reusing the AVAILABILITY_WINDOWS vocabulary. */
    preferredWindows: { type: [String], default: [] },
    sessionsPerWeek: { type: Number, default: 1, min: 1, max: 7 },
    preferredDurationMinutes: { type: Number, default: 60 },

    budgetMinCents: { type: Number, min: 0 },
    budgetMaxCents: { type: Number, min: 0, index: true },

    /**
     * Tutor preferences the matcher scores against (§41 Phase 2).
     *
     * Preferences, not filters: an empty list scores neutrally rather than
     * excluding anyone, and none of them can override the hard eligibility
     * gates in `lib/matching/eligibility`.
     */
    languages: { type: [String], default: [] },
    minYearsExperience: { type: Number, min: 0, max: 50 },
    preferredQualifications: {
      type: [String],
      enum: Object.values(QUALIFICATION_TYPES),
      default: [],
    },

    urgency: {
      type: String,
      enum: Object.values(REQUEST_URGENCY),
      default: REQUEST_URGENCY.FLEXIBLE,
      index: true,
    },
    /**
     * Who the request is shown to. INVITE_ONLY is enforced in the service on
     * every read and every response, never by omitting it from a list (§10).
     */
    visibility: {
      type: String,
      enum: Object.values(REQUEST_VISIBILITY),
      default: REQUEST_VISIBILITY.PUBLIC,
      index: true,
    },

    goal: { type: String, trim: true, maxlength: 500 },
    startDate: { type: Date },
    notes: { type: String, trim: true, maxlength: 2000 },

    status: {
      type: String,
      enum: Object.values(REQUEST_STATUS),
      default: REQUEST_STATUS.OPEN,
      index: true,
    },

    interestedCount: { type: Number, default: 0 },
    invitedCount: { type: Number, default: 0 },
    suggestedCount: { type: Number, default: 0 },
    /** Views by tutors, for the family's "is anyone looking?" signal. */
    viewCount: { type: Number, default: 0 },

    expiresAt: { type: Date, index: true },
    /** Set once so the "expiring soon" warning is never sent twice (§28). */
    expiryWarnedAt: { type: Date },
    /** When the matcher last ran, so an edit can tell it needs to run again. */
    lastMatchedAt: { type: Date },

    editCount: { type: Number, default: 0 },
    lastEditedAt: { type: Date },

    closedAt: { type: Date },
    cancelledAt: { type: Date },
    closeReason: { type: String, trim: true, maxlength: 300 },
    bookedTutorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorProfile" },
    matchedAt: { type: Date },

    /** Moderation trail. Only an administrator ever writes these (§23, §35). */
    removedAt: { type: Date },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    moderationNote: { type: String, trim: true, maxlength: 600 },
    moderationHistory: { type: [ModerationEntrySchema], default: [] },
  },
  { timestamps: true },
);

TutorRequestSchema.index({ status: 1, courseId: 1, createdAt: -1 });
TutorRequestSchema.index({ ownerId: 1, createdAt: -1 });
TutorRequestSchema.index({ location: "2dsphere" }, { sparse: true });
// The tutor board: open, publicly visible requests for a subject, newest first.
TutorRequestSchema.index({ status: 1, visibility: 1, subjectId: 1, createdAt: -1 });
// The expiry sweep and the "expiring soon" warning both read this shape.
TutorRequestSchema.index({ status: 1, expiresAt: 1 });

export const TutorRequest =
  mongoose.models.TutorRequest || mongoose.model("TutorRequest", TutorRequestSchema);

/**
 * Per-factor points, stored so the family's comparison view can explain *why*
 * a tutor was surfaced — and so an explanation written months ago still reads
 * against the weights that actually produced it.
 *
 * Generated from `MATCH_FACTOR_KEYS` so a new factor needs no migration: an
 * older document simply has no value for it, which reads as zero.
 */
const ScoreBreakdownSchema = new mongoose.Schema(
  Object.fromEntries(MATCH_FACTOR_KEYS.map((key) => [key, { type: Number, default: 0 }])),
  { _id: false, minimize: false },
);

/**
 * A tutor's relationship to a request: suggested by the matcher, invited by
 * the family, or self-declared interest.
 */
const TutorMatchSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorRequest",
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

    status: {
      type: String,
      enum: Object.values(MATCH_STATUS),
      default: MATCH_STATUS.SUGGESTED,
      index: true,
    },

    /** 0–100 overall, with the contributing factors kept for transparency. */
    score: { type: Number, default: 0, index: true },
    scoreBreakdown: { type: ScoreBreakdownSchema, default: () => ({}) },
    /**
     * The normalised weights this score was computed with. Without them an
     * explanation re-read after an operator retuned the marketplace would
     * describe the match against numbers it was never scored on.
     */
    scoreWeights: { type: mongoose.Schema.Types.Mixed },
    scoredAt: { type: Date },
    distanceKm: { type: Number },

    /** The tutor's pitch when they express interest. */
    message: { type: String, trim: true, maxlength: 1200 },
    proposedRateCents: { type: Number, min: 0 },
    respondedAt: { type: Date },

    /** Invitation and refusal trail — each set once, by whoever acted. */
    invitedAt: { type: Date },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    declinedAt: { type: Date },
    declineReason: { type: String, trim: true, maxlength: 300 },
    withdrawnAt: { type: Date },
    shortlistedAt: { type: Date },
    bookedAt: { type: Date },

    viewedByOwnerAt: { type: Date },
    viewedByTutorAt: { type: Date },
  },
  { timestamps: true },
);

TutorMatchSchema.index({ requestId: 1, tutorProfileId: 1 }, { unique: true });
TutorMatchSchema.index({ requestId: 1, score: -1 });
TutorMatchSchema.index({ tutorUserId: 1, status: 1, createdAt: -1 });
TutorMatchSchema.index({ tutorProfileId: 1, status: 1 });

export const TutorMatch =
  mongoose.models.TutorMatch || mongoose.model("TutorMatch", TutorMatchSchema);
