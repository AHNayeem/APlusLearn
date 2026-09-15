import mongoose from "mongoose";
import {
  TUTOR_STATUS,
  LESSON_MODES,
  VERIFICATION_TYPES,
  QUALIFICATION_TYPES,
  IN_PERSON_LOCATIONS,
  MEETING_PROVIDERS,
} from "../constants/index.js";
const EducationSchema = new mongoose.Schema(
  {
    institution: { type: String, required: true, trim: true },
    credential: { type: String, required: true, trim: true }, // "BSc Mathematics"
    fieldOfStudy: { type: String, trim: true },
    startYear: { type: Number },
    endYear: { type: Number },
    inProgress: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
  },
  { _id: true },
);

const ExperienceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    organisation: { type: String, trim: true },
    startYear: { type: Number },
    endYear: { type: Number },
    current: { type: Boolean, default: false },
    description: { type: String, trim: true, maxlength: 600 },
  },
  { _id: true },
);

/**
 * A course the tutor teaches, with an optional per-course rate override.
 * Denormalised code/name keep search result cards cheap to render.
 */
const TaughtCourseSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    code: { type: String, uppercase: true, trim: true },
    name: { type: String, trim: true },
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: "Subject" },
    subjectSlug: { type: String },
    gradeLevel: { type: Number },
    gradeSlug: { type: String },
    provinceCode: { type: String, uppercase: true },
    /** Overrides `hourlyRateCents` when set. */
    hourlyRateCents: { type: Number, min: 0 },
    yearsTeaching: { type: Number, min: 0, default: 0 },
  },
  { _id: false },
);

const VerificationBadgeSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(VERIFICATION_TYPES), required: true },
    grantedAt: { type: Date, default: Date.now },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date },
  },
  { _id: false },
);

const StatsSchema = new mongoose.Schema(
  {
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    /** Sub-scores mirrored from Review so profile cards avoid an aggregation. */
    ratingKnowledge: { type: Number, default: 0 },
    ratingCommunication: { type: Number, default: 0 },
    ratingReliability: { type: Number, default: 0 },
    ratingTeaching: { type: Number, default: 0 },
    completedLessons: { type: Number, default: 0 },
    totalStudents: { type: Number, default: 0 },
    repeatStudents: { type: Number, default: 0 },
    responseTimeMinutes: { type: Number, default: null },
    cancellationCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
  },
  { _id: false },
);

const TutorProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    /** Stable public URL segment, e.g. /tutors/sarah-m-a1b2c3 (§29). */
    slug: { type: String, required: true, unique: true, index: true },

    headline: { type: String, trim: true, maxlength: 120 },
    bio: { type: String, trim: true, maxlength: 4000 },
    introVideoUrl: { type: String, trim: true },
    /**
     * Teaching-environment photos shown on search cards and the profile
     * gallery. Never an image of a home exterior or anything address-revealing
     * (§15, §42) — moderation covers that at upload time.
     */
    gallery: { type: [String], default: [] },

    status: {
      type: String,
      enum: Object.values(TUTOR_STATUS),
      default: TUTOR_STATUS.DRAFT,
      index: true,
    },
    /**
     * Denormalised search gate. True only when status === APPROVED and the
     * profile is complete — the single field every public query filters on.
     */
    isSearchable: { type: Boolean, default: false, index: true },
    approvedAt: { type: Date },

    education: { type: [EducationSchema], default: [] },
    experience: { type: [ExperienceSchema], default: [] },
    qualifications: {
      type: [String],
      enum: Object.values(QUALIFICATION_TYPES),
      default: [],
      index: true,
    },
    octNumber: { type: String, trim: true },
    yearsExperience: { type: Number, default: 0, min: 0, index: true },

    courses: { type: [TaughtCourseSchema], default: [] },
    /** Flattened for indexable search. Maintained alongside `courses`. */
    courseIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Course", index: true }],
    courseCodes: [{ type: String, uppercase: true, index: true }],
    subjectIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subject", index: true }],
    subjectSlugs: [{ type: String, index: true }],
    gradeLevels: [{ type: Number, index: true }],
    provinceCodes: [{ type: String, uppercase: true, index: true }],

    lessonModes: {
      type: [String],
      enum: Object.values(LESSON_MODES),
      default: [LESSON_MODES.ONLINE],
      index: true,
    },
    onlineMeetingProviders: {
      type: [String],
      enum: Object.values(MEETING_PROVIDERS),
      default: [MEETING_PROVIDERS.ZOOM],
    },
    inPersonLocationTypes: {
      type: [String],
      enum: Object.values(IN_PERSON_LOCATIONS),
      default: [],
    },

    /**
     * Service area. `location` is the *approximate* centre (postal-code
     * centroid), never the exact residential address (§15, §42).
     */
    city: { type: String, trim: true, index: true },
    province: { type: String, trim: true, uppercase: true, index: true },
    postalCodePrefix: { type: String, trim: true, uppercase: true }, // "M1B"
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [-79.3832, 43.6532] }, // [lng, lat]
    },
    travelRadiusKm: { type: Number, default: 15, min: 0, max: 200 },

    hourlyRateCents: { type: Number, required: true, min: 0, index: true },
    /** Cheapest across base + per-course overrides; used for range filtering. */
    minHourlyRateCents: { type: Number, index: true },
    offersFreeIntro: { type: Boolean, default: false },
    trialRateCents: { type: Number, min: 0 },

    languages: { type: [String], default: ["English"] },
    timeZone: { type: String, default: "America/Toronto" },

    verificationBadges: { type: [VerificationBadgeSchema], default: [] },
    /** Flattened badge types for indexable filtering. */
    verifiedTypes: {
      type: [String],
      enum: Object.values(VERIFICATION_TYPES),
      default: [],
      index: true,
    },

    stats: { type: StatsSchema, default: () => ({}) },

    /** Cached by the availability service for "next available" on cards (§14). */
    nextAvailableAt: { type: Date, default: null, index: true },

    acceptingNewStudents: { type: Boolean, default: true, index: true },

    adminNotes: { type: String, select: false },
    rejectionReason: { type: String },
    infoRequestedMessage: { type: String },
  },
  { timestamps: true },
);

TutorProfileSchema.index({ location: "2dsphere" });
// The dominant search shape: searchable tutors filtered by course, sorted.
TutorProfileSchema.index({ isSearchable: 1, courseIds: 1, hourlyRateCents: 1 });
TutorProfileSchema.index({ isSearchable: 1, subjectSlugs: 1, "stats.ratingAverage": -1 });
// MongoDB refuses a compound index over two array fields ("parallel arrays"),
// so province and grade are indexed separately alongside the search gate.
TutorProfileSchema.index({ isSearchable: 1, provinceCodes: 1 });
TutorProfileSchema.index({ isSearchable: 1, gradeLevels: 1 });
TutorProfileSchema.index({ status: 1, updatedAt: -1 });
TutorProfileSchema.index({ headline: "text", bio: "text" }, { name: "tutor_text" });

TutorProfileSchema.set("toObject", { virtuals: true });
TutorProfileSchema.set("toJSON", { virtuals: true });

export const TutorProfile =
  mongoose.models.TutorProfile || mongoose.model("TutorProfile", TutorProfileSchema);
export default TutorProfile;
