import mongoose from "mongoose";
import { REVIEW_STATUS, NOTIFICATION_TYPES, NOTIFICATION_CHANNELS } from "../constants/index.js";
const FavouriteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true },
);

FavouriteSchema.index({ userId: 1, tutorProfileId: 1 }, { unique: true });
FavouriteSchema.index({ userId: 1, createdAt: -1 });

export const Favourite =
  mongoose.models.Favourite || mongoose.model("Favourite", FavouriteSchema);

/**
 * Reviews are only creatable from a COMPLETED booking, and each booking
 * yields at most one review — enforced by the unique index plus a service
 * check (§23, §42).
 */
const ReviewSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      unique: true,
      index: true,
    },
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    studentProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "StudentProfile" },

    courseId: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
    courseCode: { type: String, uppercase: true, trim: true },
    courseName: { type: String, trim: true },

    rating: { type: Number, required: true, min: 1, max: 5, index: true },
    knowledge: { type: Number, min: 1, max: 5 },
    communication: { type: Number, min: 1, max: 5 },
    reliability: { type: Number, min: 1, max: 5 },
    teaching: { type: Number, min: 1, max: 5 },

    title: { type: String, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 2000 },

    /** Always true in the MVP: a review cannot exist without a booking. */
    isVerified: { type: Boolean, default: true },

    status: {
      type: String,
      enum: Object.values(REVIEW_STATUS),
      default: REVIEW_STATUS.PUBLISHED,
      index: true,
    },
    tutorReply: { type: String, trim: true, maxlength: 1200 },
    tutorRepliedAt: { type: Date },

    reportedAt: { type: Date },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reportReason: { type: String, trim: true },
    moderatedAt: { type: Date },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    moderationNote: { type: String, trim: true },
  },
  { timestamps: true },
);

ReviewSchema.index({ tutorProfileId: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ status: 1, reportedAt: -1 });

export const Review = mongoose.models.Review || mongoose.model("Review", ReviewSchema);

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, trim: true, maxlength: 600 },
    /** In-app deep link; the notification centre renders it as the row action. */
    href: { type: String, trim: true },

    /** Loose references so a notification can point at any domain object. */
    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },

    readAt: { type: Date, default: null },

    /**
     * Which channels this notification was dispatched on. The MVP writes
     * IN_APP; email/SMS/push providers plug in behind the same record (§28).
     */
    deliveredChannels: {
      type: [String],
      enum: Object.values(NOTIFICATION_CHANNELS),
      default: [NOTIFICATION_CHANNELS.IN_APP],
    },
  },
  { timestamps: true },
);

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification =
  mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
