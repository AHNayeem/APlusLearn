import mongoose from "mongoose";
import {
  PROGRESS_REPORT_STATUS,
  PROGRESS_RATINGS,
  GOAL_PROGRESS,
} from "../constants/index.js";
import { AttachmentSchema } from "./Attachment.js";

/**
 * Where one learning goal stands, as of one report.
 *
 * `goalId` points at an entry in `StudentProfile.learningGoals`, which is the
 * foundation this builds on: goals belong to the learner and outlive any one
 * tutor, while the assessment of them belongs to the report.
 */
const GoalProgressSchema = new mongoose.Schema(
  {
    goalId: { type: mongoose.Schema.Types.ObjectId },
    /** Copied at the time, so a renamed goal does not rewrite an old report. */
    label: { type: String, required: true, trim: true, maxlength: 200 },
    status: {
      type: String,
      enum: Object.values(GOAL_PROGRESS),
      default: GOAL_PROGRESS.IN_PROGRESS,
    },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

/** Something the learner achieved. Additive; a milestone is never un-earned. */
const MilestoneSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 200 },
    achievedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

/**
 * A report as it read before an edit.
 *
 * This is the whole point of the model: once a family has been shown a
 * report, changing it must not erase what they were shown. Editing a
 * submitted report snapshots the previous version here first, so the history
 * is preserved rather than overwritten (§41 Phase 2).
 */
const RevisionSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reason: { type: String, trim: true, maxlength: 300 },
    /** The fields that carry meaning, exactly as they read before the edit. */
    snapshot: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: true },
);

const ProgressReportSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },

    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    studentProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentProfile",
      required: true,
      index: true,
    },
    /**
     * The account that may read this. Resolved from the learner at creation
     * rather than taken from a request, and kept here so the read query is a
     * single indexed lookup instead of a join (§42).
     */
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course", index: true },
    courseCode: { type: String, uppercase: true, trim: true },
    courseName: { type: String, trim: true },

    /** The lessons this report covers, and the window they span. */
    bookingIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }],
    lessonCount: { type: Number, default: 0, min: 0 },
    periodStart: { type: Date },
    periodEnd: { type: Date },

    status: {
      type: String,
      enum: Object.values(PROGRESS_REPORT_STATUS),
      default: PROGRESS_REPORT_STATUS.DRAFT,
      index: true,
    },

    summary: { type: String, trim: true, maxlength: 3000 },
    strengths: { type: String, trim: true, maxlength: 2000 },
    focusAreas: { type: String, trim: true, maxlength: 2000 },
    homework: { type: String, trim: true, maxlength: 2000 },

    /**
     * The homework itself, rather than a description of it (§41 Phase 3).
     *
     * `homework` has always been the tutor's written instruction; this is the
     * worksheet that goes with it. It lives on the report rather than in the
     * message thread because the report is the document a family keeps, and
     * because the report already knows exactly who may read it — `ownerId`
     * and `tutorUserId` are the audience, resolved at creation and not from
     * any request.
     *
     * Deliberately *not* here: a due date, a submission, a mark, a status. A
     * worksheet a tutor shared is a file; an assignment that is handed in and
     * graded is a domain with rules nobody has written down yet. The learner
     * returns their work the way they already can — in the thread.
     */
    homeworkAttachments: { type: [AttachmentSchema], default: [] },

    ratings: {
      type: new mongoose.Schema(
        Object.fromEntries(
          Object.values(PROGRESS_RATINGS).map((key) => [key, { type: Number, min: 1, max: 5 }]),
        ),
        { _id: false },
      ),
      default: () => ({}),
    },

    goals: { type: [GoalProgressSchema], default: [] },
    milestones: { type: [MilestoneSchema], default: [] },

    /**
     * A note only the tutor sees. Kept apart from `summary` so there is a
     * place for "not sure they are doing the homework" that is not a thing
     * the family has been told (§35).
     */
    privateNote: { type: String, trim: true, maxlength: 2000, select: false },

    submittedAt: { type: Date, index: true },
    acknowledgedAt: { type: Date },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    archivedAt: { type: Date },

    revisions: { type: [RevisionSchema], default: [] },
  },
  { timestamps: true },
);

// The family's history for one learner, newest first.
ProgressReportSchema.index({ studentProfileId: 1, status: 1, submittedAt: -1 });
// The tutor's own list.
ProgressReportSchema.index({ tutorUserId: 1, status: 1, updatedAt: -1 });
// The family's "anything new?" badge.
ProgressReportSchema.index({ ownerId: 1, status: 1, acknowledgedAt: 1 });

export const ProgressReport =
  mongoose.models.ProgressReport || mongoose.model("ProgressReport", ProgressReportSchema);
export default ProgressReport;
