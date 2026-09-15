import mongoose from "mongoose";

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

    reportedAt: { type: Date },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reportReason: { type: String, trim: true },
  },
  { timestamps: true },
);

ConversationSchema.index({ participantIds: 1, lastMessageAt: -1 });
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
    body: { type: String, required: true, trim: true, maxlength: 4000 },

    /**
     * Attachment shape is defined now so Phase 2 file sharing needs no
     * migration; the MVP never populates it (§21, §41).
     */
    attachments: {
      type: [
        new mongoose.Schema(
          {
            fileName: String,
            contentType: String,
            sizeBytes: Number,
            storageKey: { type: String, select: false },
          },
          { _id: true },
        ),
      ],
      default: [],
    },

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
