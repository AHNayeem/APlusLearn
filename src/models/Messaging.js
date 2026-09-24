import mongoose from "mongoose";
import { REPORT_STATUS } from "../constants/index.js";
import { ModerationEntrySchema } from "./Engagement.js";
import { AttachmentSchema } from "./Attachment.js";

/**
 * A conversation is always exactly one learner-side account and one tutor.
 * `participantIds` is kept sorted so a pair maps to a single conversation.
 */
const ConversationSchema = new mongoose.Schema(
  {
    participantIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      required: true,
      validate: [(v) => v.length === 2, "A conversation has exactly two participants"],
    },
    learnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorProfile", index: true },

    /** Optional booking that started the thread, shown as context (§21). */
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    /** Optional tutor request that started the thread. */
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorRequest" },

    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, trim: true, maxlength: 200 },
    lastMessageSenderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    /** Per-user unread counters, keyed by user id string. */
    unreadCounts: { type: Map, of: Number, default: () => new Map() },

    /** Users who archived / blocked this thread. */
    archivedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    /**
     * Safeguarding (§21, §35).
     *
     * A report on a platform used by minors has to reach a person. These
     * fields are the case: `reportStatus` is what puts the thread in the
     * admin queue and what takes it out again, and `moderationHistory` is the
     * trail of who did what to it.
     */
    reportStatus: { type: String, enum: Object.values(REPORT_STATUS), index: true },
    reportedAt: { type: Date },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reportReason: { type: String, trim: true },
    reportCount: { type: Number, default: 0 },
    moderationHistory: { type: [ModerationEntrySchema], default: [] },
    moderatedAt: { type: Date },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    moderationNote: { type: String, trim: true, maxlength: 600 },
  },
  { timestamps: true },
);

ConversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
ConversationSchema.index({ reportStatus: 1, reportedAt: -1 });
ConversationSchema.index({ learnerUserId: 1, tutorUserId: 1 }, { unique: true });

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", ConversationSchema);

const MessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /**
     * Required, unless the message *is* the file.
     *
     * "Here's your worksheet" with nothing typed is an ordinary thing to
     * send, so a message carrying an attachment may have an empty body. The
     * requirement is expressed as a function rather than dropped, because a
     * message with neither text nor a file is still nothing at all.
     */
    body: {
      type: String,
      required: function bodyRequired() {
        return !this.attachments?.length;
      },
      trim: true,
      maxlength: 4000,
    },

    /**
     * Files shared in this thread (§21, §41 Phase 3).
     *
     * The shape was declared here long before anything populated it, so that
     * turning file sharing on would need no migration. It now points at the
     * shared `AttachmentSchema`, which keeps those original four fields and
     * adds the uploader, the time and a checksum — so a message attachment
     * and a progress-report attachment are the same thing, validated the same
     * way and served by the same rules.
     */
    attachments: { type: [AttachmentSchema], default: [] },

    /** System messages narrate booking events inside the thread. */
    kind: { type: String, enum: ["USER", "SYSTEM"], default: "USER" },
    systemEvent: { type: String, trim: true },

    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    readAt: { type: Date },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });

export const Message = mongoose.models.Message || mongoose.model("Message", MessageSchema);
