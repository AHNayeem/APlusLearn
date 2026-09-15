import mongoose from "mongoose";
import { DISPUTE_STATUS, DISPUTE_REASONS, AUDIT_ACTIONS, DEFAULT_SETTINGS } from "../constants/index.js";
const DisputeSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
    raisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    raisedByRole: { type: String, required: true },
    againstUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    reason: { type: String, enum: Object.values(DISPUTE_REASONS), required: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    requestedRefundCents: { type: Number, min: 0 },

    status: {
      type: String,
      enum: Object.values(DISPUTE_STATUS),
      default: DISPUTE_STATUS.OPEN,
      index: true,
    },

    adminNotes: {
      type: [
        new mongoose.Schema(
          {
            adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            note: { type: String, trim: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolutionNote: { type: String, trim: true },
    refundIssuedCents: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true },
);

DisputeSchema.index({ status: 1, createdAt: -1 });

export const Dispute = mongoose.models.Dispute || mongoose.model("Dispute", DisputeSchema);

/**
 * Append-only audit trail for security-relevant and admin actions (§35).
 */
const AuditLogSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    actorRole: { type: String },
    action: { type: String, enum: Object.values(AUDIT_ACTIONS), required: true, index: true },

    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },

    /** Before/after summary — never raw secrets. */
    metadata: { type: mongoose.Schema.Types.Mixed },

    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.models.AuditLog || mongoose.model("AuditLog", AuditLogSchema);

/**
 * Singleton platform settings. Admin-editable values that business rules read
 * at runtime — commission, cancellation windows, booking guard rails (§20, §26).
 */
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "PLATFORM", unique: true, index: true },

    commissionPercent: { type: Number, default: DEFAULT_SETTINGS.commissionPercent, min: 0, max: 50 },
    freeCancellationWindowHours: {
      type: Number,
      default: DEFAULT_SETTINGS.freeCancellationWindowHours,
      min: 0,
    },
    lateCancellationRefundPercent: {
      type: Number,
      default: DEFAULT_SETTINGS.lateCancellationRefundPercent,
      min: 0,
      max: 100,
    },
    studentNoShowRefundPercent: {
      type: Number,
      default: DEFAULT_SETTINGS.studentNoShowRefundPercent,
      min: 0,
      max: 100,
    },
    tutorNoShowRefundPercent: {
      type: Number,
      default: DEFAULT_SETTINGS.tutorNoShowRefundPercent,
      min: 0,
      max: 100,
    },
    cancellationAbuseThreshold: {
      type: Number,
      default: DEFAULT_SETTINGS.cancellationAbuseThreshold,
      min: 1,
    },
    cancellationAbuseWindowDays: {
      type: Number,
      default: DEFAULT_SETTINGS.cancellationAbuseWindowDays,
      min: 1,
    },
    minimumBookingNoticeHours: {
      type: Number,
      default: DEFAULT_SETTINGS.minimumBookingNoticeHours,
      min: 0,
    },
    bookingHorizonDays: { type: Number, default: DEFAULT_SETTINGS.bookingHorizonDays, min: 1 },
    minHourlyRate: { type: Number, default: DEFAULT_SETTINGS.minHourlyRate, min: 0 },
    maxHourlyRate: { type: Number, default: DEFAULT_SETTINGS.maxHourlyRate, min: 1 },
    payoutHoldDays: { type: Number, default: DEFAULT_SETTINGS.payoutHoldDays, min: 0 },
    defaultSearchRadiusKm: { type: Number, default: DEFAULT_SETTINGS.defaultSearchRadiusKm, min: 1 },
    autoModerateReviews: { type: Boolean, default: DEFAULT_SETTINGS.autoModerateReviews },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const Settings = mongoose.models.Settings || mongoose.model("Settings", SettingsSchema);
