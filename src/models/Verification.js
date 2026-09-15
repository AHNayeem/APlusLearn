import mongoose from "mongoose";
import { VERIFICATION_TYPES, VERIFICATION_STATUS, DOCUMENT_STATUS } from "../constants/index.js";
/**
 * Uploaded proof. In the MVP the file itself is referenced by an opaque
 * storage key rather than a public URL, so documents are only ever streamed
 * to an authorised admin (§35).
 */
const VerificationDocumentSchema = new mongoose.Schema(
  {
    verificationRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VerificationRecord",
      required: true,
      index: true,
    },
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    type: { type: String, enum: Object.values(VERIFICATION_TYPES), required: true },
    fileName: { type: String, required: true, trim: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    /** Private storage key — never exposed to non-admin clients. */
    storageKey: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: Object.values(DOCUMENT_STATUS),
      default: DOCUMENT_STATUS.UPLOADED,
    },
    reviewerNote: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const VerificationRecordSchema = new mongoose.Schema(
  {
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: Object.values(VERIFICATION_TYPES), required: true },
    status: {
      type: String,
      enum: Object.values(VERIFICATION_STATUS),
      default: VERIFICATION_STATUS.NOT_SUBMITTED,
      index: true,
    },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewerNote: { type: String, trim: true },
    /** Background checks and OCT memberships lapse and must be re-supplied. */
    expiresAt: { type: Date },
    /** Reference number (OCT registration, check reference, etc.). */
    referenceNumber: { type: String, trim: true },
  },
  { timestamps: true },
);

VerificationRecordSchema.index({ tutorProfileId: 1, type: 1 }, { unique: true });
VerificationRecordSchema.index({ status: 1, submittedAt: -1 });

export const VerificationRecord =
  mongoose.models.VerificationRecord ||
  mongoose.model("VerificationRecord", VerificationRecordSchema);

export const VerificationDocument =
  mongoose.models.VerificationDocument ||
  mongoose.model("VerificationDocument", VerificationDocumentSchema);
