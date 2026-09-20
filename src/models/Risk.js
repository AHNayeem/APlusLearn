import mongoose from "mongoose";
import {
  RISK_SIGNALS,
  RISK_CASE_STATUS,
  OPEN_RISK_CASE_STATUSES,
  RISK_LEVELS,
  RISK_ACTIONS,
} from "../constants/index.js";

/**
 * One thing that fired, and the evidence for it (§41 Phase 2).
 *
 * `dedupeKey` is what makes the whole feature safe to wire into event
 * handlers that retry. A replayed webhook, a double-clicked cancellation or a
 * scheduler running twice all produce the same key, and the same key is
 * recorded once. Without it, "repeated payment failures" would become a
 * signal that fires again every time the provider redelivers the event that
 * proves it.
 *
 * `evidence` is a small, human-readable summary — counts, references, a
 * window. Never a card number, never a raw provider payload, never anything
 * the audit trail would not be allowed to hold (§35).
 */
const RiskSignalSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(RISK_SIGNALS), required: true },
    detectedAt: { type: Date, default: Date.now },
    /** Why this fired, in a sentence an administrator can act on. */
    summary: { type: String, trim: true, maxlength: 400 },
    evidence: { type: mongoose.Schema.Types.Mixed },
    /** What the signal was about, so a reviewer can open it. */
    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    dedupeKey: { type: String, required: true, trim: true },
  },
  { _id: true },
);

const RiskActionSchema = new mongoose.Schema(
  {
    action: { type: String, enum: Object.values(RISK_ACTIONS), required: true },
    byId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true, maxlength: 600 },
  },
  { _id: true },
);

/**
 * A risk case (§41 Phase 2).
 *
 * One record per account under suspicion, accumulating signals rather than
 * spawning a case per event — which is what makes "this account has three
 * different problems" visible instead of three unrelated rows nobody
 * connects.
 *
 * The case is deliberately an *explanation*, not a verdict. `score` and
 * `level` are derived from the signals inside the window and recomputed on
 * every write; neither is settable by a client and neither, on its own,
 * causes the platform to do anything. A person reads the signals and decides.
 *
 * Nothing is ever deleted. A resolved case keeps its signals and its actions,
 * because the record that an account was investigated and cleared is as much
 * evidence as the record that it was not.
 */
const RiskCaseSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, index: true },

    subjectUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** The role the account held when the case opened, for context. */
    subjectRole: { type: String, trim: true },

    status: {
      type: String,
      enum: Object.values(RISK_CASE_STATUS),
      default: RISK_CASE_STATUS.OPEN,
      index: true,
    },
    level: {
      type: String,
      enum: Object.values(RISK_LEVELS),
      default: RISK_LEVELS.LOW,
      index: true,
    },
    /** Distinct signal types inside the window. Derived, never supplied. */
    score: { type: Number, default: 0, min: 0 },

    signals: { type: [RiskSignalSchema], default: [] },
    actions: { type: [RiskActionSchema], default: [] },

    firstDetectedAt: { type: Date, default: Date.now },
    lastSignalAt: { type: Date, default: Date.now, index: true },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
    resolutionNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

/**
 * One open case per account.
 *
 * A partial unique index rather than a service-side check: two signals firing
 * for the same account in the same instant is the ordinary case, not the rare
 * one, and only the database can settle that race. Resolved cases are
 * excluded, so an account's history is unbounded.
 */
RiskCaseSchema.index(
  { subjectUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: OPEN_RISK_CASE_STATUSES } },
    name: "one_open_risk_case_per_user",
  },
);

/**
 * A signal is recorded once, ever.
 *
 * Scoped across all cases rather than within one, so a signal cannot be
 * replayed into a *second* case after the first was resolved. Sparse and
 * unique on the nested key — this is the idempotency guarantee the event
 * handlers rely on.
 */
RiskCaseSchema.index(
  { "signals.dedupeKey": 1 },
  { unique: true, sparse: true, name: "risk_signal_dedupe" },
);

// The review queue: loudest and freshest first.
RiskCaseSchema.index({ status: 1, level: 1, lastSignalAt: -1 });
RiskCaseSchema.index({ createdAt: -1 });

export const RiskCase = mongoose.models.RiskCase || mongoose.model("RiskCase", RiskCaseSchema);

export default RiskCase;
