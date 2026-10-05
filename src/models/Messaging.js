import mongoose from "mongoose";
import { REPORT_STATUS, MESSAGE_SYSTEM_EVENTS } from "../constants/index.js";
import { CONTACT_FINDING_KINDS } from "../lib/messaging/contact-detection.js";
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
// What the realtime poll source reads on a standalone server (docs/REALTIME.md).
ConversationSchema.index({ updatedAt: 1 });

export const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", ConversationSchema);

/**
 * What the off-platform check found in a message (§17, R17.7).
 *
 * Kinds and a time — never the text that was removed. The point of masking is
 * that the contact detail is not kept, and a copy of it here would be the
 * detail kept.
 */
const MessageModerationSchema = new mongoose.Schema(
  {
    flagged: { type: Boolean, default: false },
    kinds: [{ type: String, enum: Object.values(CONTACT_FINDING_KINDS) }],
    /** Set only when something was actually removed from the body. */
    maskedAt: { type: Date },
  },
  { _id: false },
);

const MessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    /** Every message has a sender except a SYSTEM one, which the platform wrote. */
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function senderRequired() {
        return this.kind !== "SYSTEM";
      },
      index: true,
    },

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

    /**
     * System messages narrate booking events inside the thread (§21, R17.3).
     * `postSystemMessage` is their only writer; they have no sender, count
     * toward nobody's unread badge and are never a "reply" for response time.
     */
    kind: { type: String, enum: ["USER", "SYSTEM"], default: "USER" },
    systemEvent: { type: String, enum: Object.values(MESSAGE_SYSTEM_EVENTS) },
    /** The booking a SYSTEM message is about. */
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: "Booking" },
    /**
     * One event, one message: a replayed confirmation finds the row it
     * already wrote. Unique among SYSTEM messages only (index below).
     */
    systemKey: { type: String, trim: true },

    /** Present when the off-platform check found something (R17.7). */
    moderation: { type: MessageModerationSchema, default: undefined },

    /**
     * The sender's own name for this message, minted in the browser before
     * the request is sent. A retry carries the same value, so a send whose
     * response was lost is answered with the stored message rather than
     * stored twice (docs/REALTIME.md).
     */
    clientId: { type: String, trim: true },

    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    readAt: { type: Date },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
// Backstop for two copies of one send arriving at once; `sendMessage` looks
// first, so a sequential retry never reaches the index.
MessageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

MessageSchema.index(
  { systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: "string" } } },
);

export const Message = mongoose.models.Message || mongoose.model("Message", MessageSchema);
