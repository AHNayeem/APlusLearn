import mongoose from "mongoose";
import { TUTOR_STATUS } from "../constants/index.js";
import { ONBOARDING_STEPS, ONBOARDING_STEP_META } from "../constants/onboarding.js";
// Step definitions live in constants/onboarding.js so the onboarding wizard's
// Client Components can import them without pulling mongoose into the browser.
export { ONBOARDING_STEPS, ONBOARDING_STEP_META };

const ReviewNoteSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true }, // APPROVED / REJECTED / INFO_REQUESTED / NOTE
    message: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * The onboarding wizard's saved state (§17). Kept separate from TutorProfile
 * so a half-finished application never risks making a profile searchable.
 */
const TutorApplicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    tutorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorProfile", index: true },

    status: {
      type: String,
      enum: Object.values(TUTOR_STATUS),
      default: TUTOR_STATUS.DRAFT,
      index: true,
    },

    /** Free-form per-step payload; validated by the step's zod schema. */
    data: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    completedSteps: { type: [String], enum: ONBOARDING_STEPS, default: [] },
    currentStep: { type: String, enum: ONBOARDING_STEPS, default: "PERSONAL" },

    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewNotes: { type: [ReviewNoteSchema], default: [] },
  },
  { timestamps: true },
);

TutorApplicationSchema.index({ status: 1, submittedAt: -1 });

TutorApplicationSchema.virtual("progressPercent").get(function progress() {
  return Math.round((this.completedSteps.length / ONBOARDING_STEPS.length) * 100);
});

TutorApplicationSchema.set("toObject", { virtuals: true });
TutorApplicationSchema.set("toJSON", { virtuals: true });

export const TutorApplication =
  mongoose.models.TutorApplication || mongoose.model("TutorApplication", TutorApplicationSchema);
export default TutorApplication;
