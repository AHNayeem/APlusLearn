import mongoose from "mongoose";
import { LEARNER_MODE_PREFERENCES } from "../constants/index.js";

const LearningGoalSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    targetDate: { type: Date },
    achievedAt: { type: Date },
  },
  { _id: true },
);

/**
 * A learner. Parents create one per child; self-serve students get exactly
 * one owned by themselves (`isSelf`), which keeps every booking pointing at
 * a single learner type.
 */
const StudentProfileSchema = new mongoose.Schema(
  {
    /** The account that owns and pays for this learner. */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** True when the owner is the learner (adult/self-serve student). */
    isSelf: { type: Boolean, default: false },

    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, trim: true, maxlength: 60 },
    avatarUrl: { type: String, trim: true },

    /** Year of birth only — we deliberately avoid storing a minor's full DOB. */
    birthYear: { type: Number, min: 1900 },

    provinceCode: { type: String, uppercase: true, trim: true, index: true },
    gradeId: { type: mongoose.Schema.Types.ObjectId, ref: "Grade", index: true },
    gradeLevel: { type: Number, index: true },
    gradeName: { type: String, trim: true },
    school: { type: String, trim: true },

    /**
     * What this learner needs tutoring in (§5): subjects, and the exact
     * provincial courses where they are known. Both are checked against the
     * learner's own province when written, so a child's record can only name
     * courses that exist where they study.
     */
    subjectsOfInterest: [{ type: mongoose.Schema.Types.ObjectId, ref: "Subject" }],
    currentCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: "Course" }],

    /** Online, in person, or either — the default a search for them uses. */
    lessonModePreference: { type: String, enum: Object.values(LEARNER_MODE_PREFERENCES) },
    /** Marks as percentages, both optional (§5). */
    currentMark: { type: Number, min: 0, max: 100 },
    targetMark: { type: Number, min: 0, max: 100 },

    learningGoals: { type: [LearningGoalSchema], default: [] },
    areasForImprovement: { type: String, trim: true, maxlength: 1000 },
    learningPreferences: { type: String, trim: true, maxlength: 1000 },
    notes: { type: String, trim: true, maxlength: 1500 },
    accessibilityNeeds: { type: String, trim: true, maxlength: 1000 },

    /**
     * Minor privacy control (§35): when true the learner's given name is
     * reduced to a first name + initial anywhere a tutor can see it.
     */
    isMinor: { type: Boolean, default: true },
    shareFullNameWithTutor: { type: Boolean, default: false },

    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

StudentProfileSchema.index({ ownerId: 1, archivedAt: 1 });
StudentProfileSchema.index({ ownerId: 1, isSelf: 1 });

StudentProfileSchema.virtual("displayName").get(function displayName() {
  if (!this.lastName) return this.firstName;
  if (this.isMinor && !this.shareFullNameWithTutor) {
    return `${this.firstName} ${this.lastName.charAt(0)}.`;
  }
  return `${this.firstName} ${this.lastName}`;
});

StudentProfileSchema.set("toObject", { virtuals: true });
StudentProfileSchema.set("toJSON", { virtuals: true });

export const StudentProfile =
  mongoose.models.StudentProfile || mongoose.model("StudentProfile", StudentProfileSchema);
export default StudentProfile;
