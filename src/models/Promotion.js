import mongoose from "mongoose";
import { PROMOTION_STATUS, OPEN_PROMOTION_STATUSES } from "../constants/index.js";

/**
 * A promoted tutor profile (§41 Phase 2).
 *
 * What this document is: an administrator's decision that one already-eligible
 * tutor should sit higher in the default discovery ordering between two
 * instants. What it is emphatically *not*: a visibility grant. Every read that
 * consults a promotion still applies `isSearchable` and every filter the
 * visitor asked for, so a promotion can change where an eligible tutor
 * appears and can never make an ineligible one appear at all (§42).
 *
 * There is no `priority`, `tier` or `boost` field, and that absence is
 * deliberate. §41 names the feature without defining any ranking arithmetic,
 * and a weight nobody specified would be a business rule invented in a schema.
 * When more promotions are running than a result set may show, the tutors are
 * ordered by the same ranking everyone else is ordered by — the promotion
 * decides *that* they are lifted, never *how far*.
 *
 * Effective activity is derived from the clock, not trusted from `status`:
 * `status === ACTIVE && startsAt <= now < endsAt`. The `promotion-expiry` job
 * settles the record afterwards, but a job that never ran cannot leave a
 * promotion running forever, because no read believes `status` on its own.
 */
const TutorPromotionSchema = new mongoose.Schema(
  {
    tutorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TutorProfile",
      required: true,
      index: true,
    },
    tutorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    status: {
      type: String,
      enum: Object.values(PROMOTION_STATUS),
      default: PROMOTION_STATUS.SCHEDULED,
      index: true,
    },

    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },

    /**
     * Why this promotion exists, in an administrator's own words. Internal:
     * it is never returned to the tutor or to a public reader, because "comped
     * after a support failure" is not the tutor's business.
     */
    note: { type: String, trim: true, maxlength: 500 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    activatedAt: { type: Date },
    pausedAt: { type: Date },
    /** When it stopped for good, whichever terminal route it took. */
    endedAt: { type: Date },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

/**
 * One live promotion per tutor.
 *
 * A partial unique index rather than a service-only check: two administrators
 * clicking "promote" on the same tutor at the same moment is exactly the race
 * a uniqueness rule exists for, and the service's own check cannot win it.
 * Terminal promotions are excluded, so a tutor's history is unbounded while
 * their present is single-valued.
 */
TutorPromotionSchema.index(
  { tutorProfileId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: OPEN_PROMOTION_STATUSES } },
    name: "one_open_promotion_per_tutor",
  },
);

// The discovery read: which promotions are live right now.
TutorPromotionSchema.index({ status: 1, startsAt: 1, endsAt: 1 });
// The admin console's list, and the expiry sweep's claim.
TutorPromotionSchema.index({ status: 1, endsAt: 1 });
TutorPromotionSchema.index({ createdAt: -1 });

/** Live this instant — the same rule every reader applies, in one place. */
TutorPromotionSchema.methods.isLiveAt = function isLiveAt(now = new Date()) {
  return (
    this.status === PROMOTION_STATUS.ACTIVE && this.startsAt <= now && this.endsAt > now
  );
};

export const TutorPromotion =
  mongoose.models.TutorPromotion || mongoose.model("TutorPromotion", TutorPromotionSchema);

export default TutorPromotion;
