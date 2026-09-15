import mongoose from "mongoose";

/**
 * A recurring weekly window, stored as minutes-from-midnight in the tutor's
 * own timezone so DST shifts do not move a tutor's Tuesday evening slot.
 */
const WeeklyRuleSchema = new mongoose.Schema(
  {
    weekday: { type: Number, required: true, min: 0, max: 6 }, // 0 = Sunday
    startMinutes: { type: Number, required: true, min: 0, max: 1440 },
    endMinutes: { type: Number, required: true, min: 0, max: 1440 },
  },
  { _id: true },
);

/** A one-off block: vacation, a specific date, or part of a day. */
const ExceptionSchema = new mongoose.Schema(
  {
    /** Inclusive UTC instants. Whole-day blocks span local midnight-to-midnight. */
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: 200 },
    kind: {
      type: String,
      enum: ["BLOCKED", "VACATION", "EXTRA"],
      default: "BLOCKED",
    },
  },
  { _id: true },
);

const AvailabilitySchema = new mongoose.Schema(
  {
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      unique: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    timeZone: { type: String, default: "America/Toronto" },

    weeklyRules: { type: [WeeklyRuleSchema], default: [] },
    exceptions: { type: [ExceptionSchema], default: [] },

    /** Minutes of buffer the tutor wants between back-to-back lessons. */
    bufferMinutes: { type: Number, default: 0, min: 0, max: 120 },
    /** Slot granularity offered to students. */
    slotIncrementMinutes: { type: Number, default: 30, min: 15, max: 60 },
    /** Overrides the platform minimum booking notice when larger. */
    minNoticeHours: { type: Number, default: 4, min: 0, max: 168 },

    /**
     * Phase-2 external calendar sync. The shape is here so connecting Google
     * or Outlook later does not require a migration (§18, §41).
     */
    externalCalendars: {
      type: [
        new mongoose.Schema(
          {
            provider: { type: String, enum: ["GOOGLE", "OUTLOOK"], required: true },
            accountEmail: { type: String, trim: true },
            connectedAt: { type: Date },
            lastSyncedAt: { type: Date },
            syncEnabled: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const Availability =
  mongoose.models.Availability || mongoose.model("Availability", AvailabilitySchema);
export default Availability;
