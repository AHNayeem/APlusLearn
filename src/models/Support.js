import mongoose from "mongoose";
import { SUPPORT_TOPICS, SUPPORT_TICKET_STATUS, ROLES } from "../constants/index.js";

/**
 * A support enquiry, as the platform's own record of it (§33, §36, R28.20).
 *
 * The enquiry used to exist only as an email, which made the email the record:
 * a bounced send lost somebody's safety report, and nobody could ask "what
 * complaints are still open?". Now the ticket is written first and the email
 * is a notification about it — the same relationship every other email in the
 * platform has with the thing it announces.
 *
 * Admin-only by construction. Nothing outside `/api/admin/support/**` reads
 * this collection, and the enquirer is told a reference rather than given a
 * way to look the ticket up — an endpoint keyed by a guessable reference
 * would hand anybody's complaint to anybody who could guess it.
 */

const NoteSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, trim: true, required: true, maxlength: 2000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const StatusChangeSchema = new mongoose.Schema(
  {
    from: { type: String, enum: Object.values(SUPPORT_TICKET_STATUS) },
    to: { type: String, enum: Object.values(SUPPORT_TICKET_STATUS), required: true },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const SupportTicketSchema = new mongoose.Schema(
  {
    /** What the enquirer is told, e.g. SUP-7F3K2Q. */
    reference: { type: String, required: true, unique: true, index: true },

    topic: { type: String, enum: Object.values(SUPPORT_TOPICS), required: true, index: true },
    /**
     * Derived from the topic when the ticket is written (`URGENT_SUPPORT_TOPICS`),
     * stored so the queue can sort on it with an index rather than a lookup.
     */
    urgent: { type: Boolean, default: false, index: true },

    status: {
      type: String,
      enum: Object.values(SUPPORT_TICKET_STATUS),
      default: SUPPORT_TICKET_STATUS.OPEN,
      index: true,
    },

    /** From the session when signed in; from the form only for a guest. */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    userRole: { type: String, enum: Object.values(ROLES), default: undefined },
    name: { type: String, trim: true, required: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, required: true, maxlength: 254 },

    message: { type: String, trim: true, required: true, maxlength: 2000 },
    /** The page they were on. Same-site path only — see `supportEnquirySchema`. */
    path: { type: String, trim: true, maxlength: 200 },

    /**
     * What happened to the inbox notification. Recorded rather than thrown:
     * a ticket whose email failed is still a ticket, and the queue is where
     * somebody notices it.
     */
    notification: {
      status: { type: String, enum: ["PENDING", "SENT", "FAILED"], default: "PENDING" },
      attemptedAt: { type: Date },
      error: { type: String, trim: true, maxlength: 200 },
    },

    notes: { type: [NoteSchema], default: [] },
    history: { type: [StatusChangeSchema], default: [] },

    resolvedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

/** The queue: urgent first, then newest, within a status. */
SupportTicketSchema.index({ status: 1, urgent: -1, createdAt: -1 });
SupportTicketSchema.index({ topic: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ urgent: -1, createdAt: -1 });

export const SupportTicket =
  mongoose.models.SupportTicket || mongoose.model("SupportTicket", SupportTicketSchema);
