import "server-only";
import { TutorPromotion, TutorProfile, User } from "@/models";
import {
  PROMOTION_STATUS,
  OPEN_PROMOTION_STATUSES,
  TERMINAL_PROMOTION_STATUSES,
  TUTOR_STATUS,
  USER_STATUS,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  PAGE_SIZES,
} from "@/constants";
import {
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  ValidationError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { livePromotionQuery, promotionLimits } from "@/lib/search/promotion";
import { getSettings } from "./settings.service";
import { requireTutorProfile } from "./tutor.service";
import { recordAudit } from "./audit.service";
import { notify } from "./notification.service";

/**
 * Promoted tutor profiles (§41 Phase 2).
 *
 * The whole feature in one sentence: an administrator can lift an
 * already-eligible tutor up the default discovery ordering for a bounded
 * window, and everybody — the tutor, the next administrator, the visitor
 * reading a labelled result — can see that it happened.
 *
 * Three rules hold this together, and every function below defers to them:
 *
 *   1. **Eligibility is never granted, only required.** `assertPromotable`
 *      re-reads the tutor's own state at create *and* at activate, and the
 *      discovery read applies the ordinary `isSearchable` gate on top. A
 *      promotion is an ordering hint layered over the marketplace's rules,
 *      never a way around them (§42).
 *
 *   2. **Live-ness is derived from the clock.** `status` records intent;
 *      `livePromotionQuery` decides effect. A promotion whose window closed
 *      stops mattering immediately, with or without the expiry job.
 *
 *   3. **Nothing terminal comes back.** EXPIRED and CANCELLED are the end of
 *      a record. Re-promoting a tutor creates a new one, so "what was running
 *      last March" stays answerable.
 */

// --- Eligibility ------------------------------------------------------------

/**
 * Every marketplace rule a tutor must already satisfy to be promotable.
 *
 * Deliberately the *same* conditions that make a profile discoverable at all,
 * read from the loaded records rather than from anything a request supplied.
 * Returning a reason rather than a boolean is what lets the admin console say
 * why a tutor cannot be promoted instead of refusing silently.
 *
 * @returns {{eligible: boolean, reason: string|null}}
 */
export function assessPromotionEligibility(profile, account) {
  if (!profile) return no("This tutor has no profile.");
  if (profile.status !== TUTOR_STATUS.APPROVED) {
    return no("Only an approved tutor profile can be promoted.");
  }
  if (!profile.isSearchable) {
    return no("This profile is not visible in search, so promoting it would do nothing.");
  }
  if (account) {
    if (account.deletedAt) return no("This account has been closed.");
    if (account.status !== USER_STATUS.ACTIVE) {
      return no("This account is not active.");
    }
  }
  return { eligible: true, reason: null };
}

function no(reason) {
  return { eligible: false, reason };
}

/** Load the tutor and hold them to every rule, or refuse. */
async function assertPromotable(tutorProfileId) {
  const profile = await TutorProfile.findById(tutorProfileId)
    .select("_id userId status isSearchable slug headline")
    .lean();
  if (!profile) throw new NotFoundError("That tutor profile no longer exists.");

  const account = await User.findById(profile.userId)
    .select("_id firstName lastName email status deletedAt role")
    .lean();

  const { eligible, reason } = assessPromotionEligibility(profile, account);
  if (!eligible) throw new BusinessRuleError(reason, "TUTOR_NOT_PROMOTABLE");

  return { profile, account };
}

// --- Lifecycle --------------------------------------------------------------

/**
 * Create a promotion.
 *
 * Starts ACTIVE when its window is already open and SCHEDULED when it is not,
 * so an administrator scheduling next month's placement does not have to come
 * back and switch it on — and so "active" never means "active in the future".
 */
export async function createPromotion(input, admin) {
  const settings = await getSettings();
  if (settings.promotions?.enabled === false) {
    throw new BusinessRuleError(
      "Promoted profiles are switched off for this platform.",
      "PROMOTIONS_DISABLED",
    );
  }

  const { profile, account } = await assertPromotable(input.tutorProfileId);

  const now = new Date();
  const startsAt = input.startsAt ? new Date(input.startsAt) : now;
  const endsAt = input.endsAt
    ? new Date(input.endsAt)
    : new Date(startsAt.getTime() + (settings.promotions.defaultDurationDays ?? 30) * 86400000);

  assertWindow(startsAt, endsAt, settings, now);

  // Checked before the write for a usable error message; the partial unique
  // index below is what actually makes it true under a race.
  const open = await TutorPromotion.findOne({
    tutorProfileId: profile._id,
    status: { $in: OPEN_PROMOTION_STATUSES },
  }).lean();
  if (open) {
    throw new ConflictError("This tutor already has a promotion that has not finished.");
  }

  await assertActiveCapacity(settings, now);

  const live = startsAt <= now && endsAt > now;

  let promotion;
  try {
    promotion = await TutorPromotion.create({
      tutorProfileId: profile._id,
      tutorUserId: profile.userId,
      status: live ? PROMOTION_STATUS.ACTIVE : PROMOTION_STATUS.SCHEDULED,
      startsAt,
      endsAt,
      note: input.note,
      createdBy: admin.id,
      activatedAt: live ? now : undefined,
    });
  } catch (error) {
    // The index won the race. Say the same thing the pre-check would have.
    if (error?.code === 11000) {
      throw new ConflictError("This tutor already has a promotion that has not finished.");
    }
    throw error;
  }

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.PROMOTION_CREATED,
    entityType: "TutorPromotion",
    entityId: promotion._id,
    metadata: {
      tutorProfileId: String(profile._id),
      tutorUserId: String(profile.userId),
      status: promotion.status,
      startsAt,
      endsAt,
    },
  });

  if (live) await notifyTutorPromoted(promotion, account);

  return toPlain(promotion);
}

/**
 * Turn a scheduled or paused promotion on.
 *
 * Eligibility is re-checked here, not assumed from creation time: a tutor
 * suspended between the two moments must not be switched back into discovery
 * by a click on an old record.
 */
export async function activatePromotion(id, admin) {
  const promotion = await loadOpen(id);
  if (promotion.status === PROMOTION_STATUS.ACTIVE) {
    // Idempotent: asking for the state it is already in is not an error.
    return toPlain(promotion);
  }

  const { account } = await assertPromotable(promotion.tutorProfileId);

  const now = new Date();
  if (promotion.endsAt <= now) {
    throw new BusinessRuleError(
      "This promotion's window has already closed. Extend it first, or create a new one.",
      "PROMOTION_WINDOW_CLOSED",
    );
  }

  promotion.status = PROMOTION_STATUS.ACTIVE;
  promotion.activatedAt = promotion.activatedAt ?? now;
  promotion.pausedAt = undefined;
  await promotion.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.PROMOTION_ACTIVATED,
    entityType: "TutorPromotion",
    entityId: promotion._id,
    metadata: { tutorProfileId: String(promotion.tutorProfileId) },
  });

  if (promotion.startsAt <= now) await notifyTutorPromoted(promotion, account);

  return toPlain(promotion);
}

/** Stop a promotion early without destroying the record. */
export async function pausePromotion(id, admin) {
  const promotion = await loadOpen(id);
  if (promotion.status === PROMOTION_STATUS.PAUSED) return toPlain(promotion);

  promotion.status = PROMOTION_STATUS.PAUSED;
  promotion.pausedAt = new Date();
  await promotion.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.PROMOTION_PAUSED,
    entityType: "TutorPromotion",
    entityId: promotion._id,
    metadata: { tutorProfileId: String(promotion.tutorProfileId) },
  });

  return toPlain(promotion);
}

/** Move the end of the window. The only date an administrator may rewrite. */
export async function extendPromotion(id, { endsAt }, admin) {
  const promotion = await loadOpen(id);
  const settings = await getSettings();
  const next = new Date(endsAt);
  const previous = promotion.endsAt;

  assertWindow(promotion.startsAt, next, settings, new Date());
  if (next <= previous) {
    throw new ValidationError(
      { fieldErrors: { endsAt: ["Pick a date after the one this promotion already ends on."] } },
      "That would shorten the promotion, not extend it.",
    );
  }

  promotion.endsAt = next;
  await promotion.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.PROMOTION_EXTENDED,
    entityType: "TutorPromotion",
    entityId: promotion._id,
    metadata: { from: previous, to: next },
  });

  return toPlain(promotion);
}

/** End a promotion for good. Terminal — a later promotion is a new record. */
export async function cancelPromotion(id, { reason } = {}, admin) {
  const promotion = await loadOpen(id);

  promotion.status = PROMOTION_STATUS.CANCELLED;
  promotion.endedAt = new Date();
  promotion.endedBy = admin.id;
  await promotion.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.PROMOTION_CANCELLED,
    entityType: "TutorPromotion",
    entityId: promotion._id,
    metadata: { tutorProfileId: String(promotion.tutorProfileId), reason: reason ?? null },
  });

  return toPlain(promotion);
}

/** Load a promotion that can still change, or explain why it cannot. */
async function loadOpen(id) {
  const promotion = await TutorPromotion.findById(id);
  if (!promotion) throw new NotFoundError("That promotion no longer exists.");
  if (TERMINAL_PROMOTION_STATUSES.includes(promotion.status)) {
    throw new BusinessRuleError(
      `This promotion has already finished (${promotion.status.toLowerCase()}). Create a new one instead.`,
      "PROMOTION_FINISHED",
    );
  }
  return promotion;
}

function assertWindow(startsAt, endsAt, settings, now) {
  if (Number.isNaN(startsAt?.getTime?.()) || Number.isNaN(endsAt?.getTime?.())) {
    throw new ValidationError({ fieldErrors: { startsAt: ["Enter valid dates."] } });
  }
  if (endsAt <= startsAt) {
    throw new ValidationError(
      { fieldErrors: { endsAt: ["The promotion has to end after it starts."] } },
      "Check the promotion dates.",
    );
  }
  if (endsAt <= now) {
    throw new ValidationError(
      { fieldErrors: { endsAt: ["Pick an end date in the future."] } },
      "Check the promotion dates.",
    );
  }

  const maxDays = settings.promotions?.maxDurationDays ?? 365;
  const days = (endsAt - startsAt) / 86400000;
  if (days > maxDays) {
    throw new BusinessRuleError(
      `A promotion can run for at most ${maxDays} days. Extend it later if it should run longer.`,
      "PROMOTION_TOO_LONG",
    );
  }
}

/**
 * The marketplace-wide ceiling on promotions.
 *
 * Counted over everything that can still reach a visitor — running, paused
 * and scheduled-but-not-yet-open — rather than only what is live this second.
 * Counting only the live ones would let an operator queue up a hundred
 * placements that all open on the same morning and sail past the ceiling on
 * the day it mattered. Finished records are excluded, so history never blocks
 * a new placement.
 */
async function assertActiveCapacity(settings, now) {
  const { maxActive } = promotionLimits(settings);
  const live = await TutorPromotion.countDocuments({
    status: { $in: OPEN_PROMOTION_STATUSES },
    endsAt: { $gt: now },
  });
  if (live >= maxActive) {
    throw new BusinessRuleError(
      `${maxActive} promotions are already running or scheduled, which is this platform's limit. End one first, or raise the limit in settings.`,
      "PROMOTION_LIMIT_REACHED",
    );
  }
}

async function notifyTutorPromoted(promotion, account) {
  if (!account) return;
  await notify({
    userId: promotion.tutorUserId,
    type: NOTIFICATION_TYPES.PROFILE_PROMOTED,
    title: "Your profile is being promoted",
    body: "APlus Learn is featuring your profile higher in search results for a limited period.",
    href: "/tutor/dashboard",
    entityType: "TutorPromotion",
    entityId: promotion._id,
  });
}

// --- Discovery --------------------------------------------------------------

/**
 * Tutor profile ids whose promotion is live right now, most recently started
 * first, bounded by the operator's ceiling.
 *
 * Returns an empty array whenever promotion cannot apply — switched off, no
 * budget for promoted slots, nothing running — so every caller can treat "no
 * promotions" as the ordinary case and add no branching of its own.
 */
export async function livePromotedProfileIds({ settings, now = new Date(), limit } = {}) {
  const resolved = settings ?? (await getSettings());
  const { enabled, maxPromotedPerSearch, maxActive } = promotionLimits(resolved);
  if (!enabled || maxPromotedPerSearch === 0 || maxActive === 0) return [];

  const cap = Math.min(limit ?? maxActive, maxActive);
  if (cap <= 0) return [];

  const live = await TutorPromotion.find(livePromotionQuery(now))
    .sort({ startsAt: -1, _id: 1 })
    .limit(cap)
    .select("tutorProfileId")
    .lean();

  return live.map((p) => String(p.tutorProfileId));
}

// --- Reading ----------------------------------------------------------------

export async function listPromotions({ status, tutorProfileId, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;
  if (tutorProfileId) query.tutorProfileId = tutorProfileId;

  const [items, total] = await Promise.all([
    TutorPromotion.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("tutorUserId", "firstName lastName email")
      .populate("tutorProfileId", "slug headline city status isSearchable")
      .populate("createdBy", "firstName lastName email")
      .lean(),
    TutorPromotion.countDocuments(query),
  ]);

  const now = new Date();
  return {
    items: toPlain(items).map((item) => ({ ...item, isLive: isLive(item, now) })),
    total,
    page,
    pageSize: size,
  };
}

export async function getPromotion(id) {
  const promotion = await TutorPromotion.findById(id)
    .populate("tutorUserId", "firstName lastName email")
    .populate("tutorProfileId", "slug headline city status isSearchable")
    .populate("createdBy", "firstName lastName email")
    .populate("endedBy", "firstName lastName email")
    .lean();
  if (!promotion) throw new NotFoundError("That promotion no longer exists.");
  return { ...toPlain(promotion), isLive: isLive(promotion, new Date()) };
}

/**
 * What a tutor is allowed to know about their own promotion (§41 Phase 2).
 *
 * Status, window and whether it is live right now — enough to explain a
 * change in how many enquiries they are getting. Not the internal note, not
 * who granted it, and nothing they could act on: a tutor cannot create,
 * extend or end a promotion, so the payload offers nothing that implies they
 * can.
 */
export async function currentPromotionForTutor(tutorProfileId) {
  const promotion = await TutorPromotion.findOne({
    tutorProfileId,
    status: { $in: OPEN_PROMOTION_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!promotion) return null;

  const now = new Date();
  return {
    id: String(promotion._id),
    status: promotion.status,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    isLive: isLive(promotion, now),
  };
}

function isLive(promotion, now) {
  return (
    promotion.status === PROMOTION_STATUS.ACTIVE &&
    new Date(promotion.startsAt) <= now &&
    new Date(promotion.endsAt) > now
  );
}

/**
 * Tutors an administrator could promote right now.
 *
 * Purely to populate a picker. It is not a security boundary and is not
 * treated as one — `assertPromotable` re-derives every rule from the stored
 * records when a promotion is actually created.
 */
export async function listPromotableTutors({ limit = 200 } = {}) {
  const promoted = await TutorPromotion.find({ status: { $in: OPEN_PROMOTION_STATUSES } })
    .select("tutorProfileId")
    .lean();
  const taken = promoted.map((p) => p.tutorProfileId);

  const profiles = await TutorProfile.find({
    status: TUTOR_STATUS.APPROVED,
    isSearchable: true,
    _id: { $nin: taken },
  })
    .sort({ "stats.ratingAverage": -1, _id: 1 })
    .limit(limit)
    .populate("userId", "firstName lastName status deletedAt")
    .lean();

  return profiles
    .filter((profile) => assessPromotionEligibility(profile, profile.userId).eligible)
    .map((profile) => ({
      id: String(profile._id),
      name: [profile.userId?.firstName, profile.userId?.lastName].filter(Boolean).join(" "),
      city: profile.city ?? null,
    }));
}

// --- Scheduled work ---------------------------------------------------------

/**
 * Settle promotions whose window has moved on (§41 Phase 2).
 *
 * Two jobs in one sweep: open a scheduled promotion whose start has arrived,
 * and close any promotion whose end has passed. Both are idempotent — each
 * document is claimed on the status it is expected to be in, so a second run
 * in the same minute matches nothing and changes nothing.
 *
 * Nothing about discovery depends on this job having run. It exists to keep
 * the stored record honest and the admin console readable; correctness comes
 * from `livePromotionQuery`, which reads the clock on every request.
 */
export async function expirePromotions({ now = new Date(), actor } = {}) {
  let activated = 0;
  let expired = 0;

  const due = await TutorPromotion.find({
    status: PROMOTION_STATUS.SCHEDULED,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  })
    .select("_id tutorProfileId tutorUserId")
    .lean();

  for (const row of due) {
    const claimed = await TutorPromotion.findOneAndUpdate(
      { _id: row._id, status: PROMOTION_STATUS.SCHEDULED },
      { $set: { status: PROMOTION_STATUS.ACTIVE, activatedAt: now } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    activated += 1;

    await recordAudit({
      actor: actor ?? { role: "SYSTEM" },
      action: AUDIT_ACTIONS.PROMOTION_ACTIVATED,
      entityType: "TutorPromotion",
      entityId: claimed._id,
      metadata: { reason: "window opened" },
    });

    const account = await User.findById(claimed.tutorUserId).select("_id").lean();
    await notifyTutorPromoted(claimed, account);
  }

  const over = await TutorPromotion.find({
    status: { $in: [PROMOTION_STATUS.SCHEDULED, PROMOTION_STATUS.ACTIVE, PROMOTION_STATUS.PAUSED] },
    endsAt: { $lte: now },
  })
    .select("_id status tutorProfileId")
    .lean();

  for (const row of over) {
    const claimed = await TutorPromotion.findOneAndUpdate(
      { _id: row._id, status: { $in: OPEN_PROMOTION_STATUSES } },
      { $set: { status: PROMOTION_STATUS.EXPIRED, endedAt: now } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    expired += 1;

    await recordAudit({
      actor: actor ?? { role: "SYSTEM" },
      action: AUDIT_ACTIONS.PROMOTION_EXPIRED,
      entityType: "TutorPromotion",
      entityId: claimed._id,
      metadata: { tutorProfileId: String(claimed.tutorProfileId) },
    });
  }

  return { examined: due.length + over.length, activated, expired };
}

/**
 * The signed-in tutor's own promotion, resolved from their session rather
 * than from anything the request supplied — a tutor cannot read another
 * tutor's placement by guessing an id, because no id is accepted (§8).
 */
export async function myPromotion(actor) {
  const profile = await requireTutorProfile(actor.id);
  return currentPromotionForTutor(profile.id ?? profile._id);
}
