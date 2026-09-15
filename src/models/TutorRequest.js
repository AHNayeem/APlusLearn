import mongoose from "mongoose";
import { REQUEST_STATUS, MATCH_STATUS, LESSON_MODES } from "../constants/index.js";
/**
 * "Post a tutor request" — the reverse marketplace. A parent describes what
 * they need and tutors express interest (§22).
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
    expiresAt: { type: Date, index: true },
    closedAt: { type: Date },
    bookedTutorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorProfile" },
  },
  { timestamps: true },
);

TutorRequestSchema.index({ status: 1, courseId: 1, createdAt: -1 });
TutorRequestSchema.index({ ownerId: 1, createdAt: -1 });
TutorRequestSchema.index({ location: "2dsphere" }, { sparse: true });

export const TutorRequest =
  mongoose.models.TutorRequest || mongoose.model("TutorRequest", TutorRequestSchema);

/**
 * A tutor's relationship to a request: either suggested by the matching
 * service or self-declared interest. Scores are stored so the parent's
 * comparison view can explain *why* a tutor was surfaced.
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
    scoreBreakdown: {
      course: { type: Number, default: 0 },
      location: { type: Number, default: 0 },
      budget: { type: Number, default: 0 },
      availability: { type: Number, default: 0 },
      quality: { type: Number, default: 0 },
    },
    distanceKm: { type: Number },

    /** The tutor's pitch when they express interest. */
    message: { type: String, trim: true, maxlength: 1200 },
    proposedRateCents: { type: Number, min: 0 },
    respondedAt: { type: Date },
    viewedByOwnerAt: { type: Date },
  },
  { timestamps: true },
);

TutorMatchSchema.index({ requestId: 1, tutorProfileId: 1 }, { unique: true });
TutorMatchSchema.index({ requestId: 1, score: -1 });
TutorMatchSchema.index({ tutorUserId: 1, status: 1, createdAt: -1 });

export const TutorMatch =
  mongoose.models.TutorMatch || mongoose.model("TutorMatch", TutorMatchSchema);
