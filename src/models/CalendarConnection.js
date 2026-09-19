import mongoose from "mongoose";
import {
  CALENDAR_PROVIDERS,
  CALENDAR_CONNECTION_STATUS,
} from "../constants/index.js";

/**
 * A period a connected calendar reports as busy. Cached rather than fetched
 * on every availability query: a family browsing a tutor's calendar would
 * otherwise put one provider API call behind every page view, which is both
 * slow and a rate limit waiting to happen.
 *
 * `freshUntil` on the connection says when the cache stops being trusted.
 */
const BusyPeriodSchema = new mongoose.Schema(
  { start: { type: Date, required: true }, end: { type: Date, required: true } },
  { _id: false },
);

/**
 * An event the *development* calendar provider is holding.
 *
 * It exists so a deployment with no Google or Microsoft credentials still has
 * a calendar integration that genuinely does something — events really are
 * created, updated and deleted, and really do come back as busy periods — and
 * so the whole flow is testable without an account at either company. No
 * production provider ever reads or writes it.
 */
const SimulatedEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true },
    title: { type: String, trim: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    timeZone: { type: String },
    cancelledAt: { type: Date },
  },
  { _id: false },
);

/**
 * One tutor's connection to one external calendar (§18, §41 Phase 2).
 *
 * Tokens are stored encrypted (`lib/security/crypto`) and are `select: false`,
 * so the ordinary path — listing connections for the settings screen, reading
 * busy periods for availability — never loads them at all. Only the token
 * refresh asks for them explicitly. Nothing in this document is ever sent to
 * a browser: `toPublicConnection` in the service decides what a person sees.
 */
const CalendarConnectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tutorProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "TutorProfile", index: true },

    provider: {
      type: String,
      enum: Object.values(CALENDAR_PROVIDERS),
      required: true,
      index: true,
    },
    /** True when this connection runs against the development implementation. */
    simulated: { type: Boolean, default: false },

    /** The account the tutor authorised, shown so they know which one it is. */
    accountEmail: { type: String, trim: true, lowercase: true },
    /** The provider's stable id for that account, for re-linking after a rename. */
    accountId: { type: String, trim: true },

    /** Which calendar within that account. Null until one is chosen. */
    calendarId: { type: String, trim: true },
    calendarName: { type: String, trim: true },
    calendarTimeZone: { type: String, trim: true },

    // --- Credentials. Encrypted at rest, never selected by default. --------
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    accessTokenExpiresAt: { type: Date, select: false },
    scope: { type: String, trim: true },

    status: {
      type: String,
      enum: Object.values(CALENDAR_CONNECTION_STATUS),
      default: CALENDAR_CONNECTION_STATUS.CONNECTED,
      index: true,
    },

    /**
     * The two directions, separately controlled.
     *
     * `syncBusy` pulls the tutor's existing commitments in, so the platform
     * stops offering a slot they are already booked for. `pushEvents` writes
     * lessons out, so the lesson shows up where they actually look.
     * A tutor may reasonably want one without the other.
     */
    syncBusy: { type: Boolean, default: true },
    pushEvents: { type: Boolean, default: true },

    busyPeriods: { type: [BusyPeriodSchema], default: [] },
    /** How far ahead `busyPeriods` covers, so a gap is never read as "free". */
    busyWindowEnd: { type: Date },
    freshUntil: { type: Date, index: true },
    lastSyncedAt: { type: Date },
    lastSyncError: { type: String, trim: true, maxlength: 300 },
    consecutiveFailures: { type: Number, default: 0 },

    simulatedEvents: { type: [SimulatedEventSchema], default: [], select: false },

    connectedAt: { type: Date, default: Date.now },
    disconnectedAt: { type: Date },
  },
  { timestamps: true },
);

// One connection per account per provider per tutor: reconnecting the same
// Google account updates the row rather than making a second one that would
// double every busy period.
CalendarConnectionSchema.index(
  { userId: 1, provider: 1, accountId: 1 },
  { unique: true, partialFilterExpression: { accountId: { $type: "string" } } },
);
CalendarConnectionSchema.index({ userId: 1, status: 1 });
// The sync job asks for connections whose cache has gone stale.
CalendarConnectionSchema.index({ status: 1, syncBusy: 1, freshUntil: 1 });

export const CalendarConnection =
  mongoose.models.CalendarConnection ||
  mongoose.model("CalendarConnection", CalendarConnectionSchema);
export default CalendarConnection;
