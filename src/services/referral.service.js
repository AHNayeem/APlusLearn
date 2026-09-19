import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Types } from "mongoose";
import { User, Referral, Booking } from "@/models";
import {
  REFERRAL_STATUS,
  REFERRAL_RISK_FLAGS,
  CREDIT_REASONS,
  BOOKING_STATUS,
  USER_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicName, formatMoney } from "@/lib/utils/format";
import { addDays } from "@/lib/utils/time";
import { getSettings } from "./settings.service";
import { grantCredit, clawBackCredit } from "./credit.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Referrals (§41 Phase 2).
 *
 * The shape of the scheme is fixed by what makes it hard to abuse, not by a
 * number:
 *
 *   **One attribution per account, for all time.** Enforced by a unique index
 *   on the referee, so it holds even against two concurrent registrations.
 *
 *   **A reward is earned by lessons, not by sign-ups.** A referral qualifies
 *   only once the new account has completed and paid for the configured
 *   number of lessons. Creating accounts costs an attacker real money before
 *   it earns them anything, which is the property that matters.
 *
 *   **Reversible.** A qualifying lesson that is later refunded reverses the
 *   referral and claws the credit back, bounded by what is left.
 *
 * The *amounts* are the operator's: §41 names the feature and prices nothing,
 * so the defaults are zero and everything else works regardless. At zero the
 * scheme still attributes, qualifies, notifies and reports — it simply grants
 * no money until somebody decides what a referral is worth.
 *
 * Risk signals are recorded and shown to administrators. None of them
 * punishes anybody automatically: the requirements define no penalties, and
 * inventing one would be worse than surfacing the signal.
 */

/** No I, O, 0 or 1 — a code gets read aloud and typed from memory. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// --- The code --------------------------------------------------------------

/**
 * This account's code, generated on first use.
 *
 * Lazily rather than at registration, so every account that existed before
 * this feature gets one the moment it looks, and no migration is needed.
 */
export async function getOrCreateReferralCode(userId) {
  const user = await User.findById(userId).select("referralCode").lean();
  if (!user) throw new NotFoundError("We couldn't find your account.");
  if (user.referralCode) return user.referralCode;

  // Retried rather than looped forever: at 32^8 the chance of two collisions
  // in a row is not worth a more elaborate scheme, and a failure here is
  // recoverable by asking again.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      const updated = await User.findOneAndUpdate(
        { _id: userId, referralCode: { $in: [null, undefined] } },
        { $set: { referralCode: code } },
        { new: true, select: "referralCode" },
      );
      if (updated?.referralCode) return updated.referralCode;

      // Somebody else set it between our read and our write.
      const current = await User.findById(userId).select("referralCode").lean();
      if (current?.referralCode) return current.referralCode;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }

  throw new BusinessRuleError("We couldn't create a referral code. Please try again.", "CODE_FAILED");
}

function randomCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Check a code before it is used, for the registration form.
 *
 * Says whether it works and who it belongs to, using the same first-name plus
 * initial the rest of the marketplace shows. It deliberately does not say
 * *why* an unknown code failed — that would turn the endpoint into a way of
 * discovering which codes exist.
 */
export async function lookupReferralCode(code) {
  const settings = await getSettings();
  if (settings.referrals?.enabled === false) return { valid: false };

  const referrer = await User.findOne({
    referralCode: String(code).toUpperCase().trim(),
    status: USER_STATUS.ACTIVE,
    deletedAt: null,
  })
    .select("firstName lastName")
    .lean();

  if (!referrer) return { valid: false };

  return {
    valid: true,
    referrerName: publicName(referrer.firstName, referrer.lastName),
    refereeRewardCents: settings.referrals?.refereeRewardCents ?? 0,
  };
}

// --- Attribution -----------------------------------------------------------

/**
 * Record that a new account arrived through a code.
 *
 * Called from registration. Never throws into the sign-up path: a referral
 * that cannot be attributed must not stop somebody creating an account, so
 * every refusal here is a quiet no-op with a reason.
 */
export async function attributeReferral({ code, refereeUserId, email, ip }) {
  try {
    const settings = await getSettings();
    if (settings.referrals?.enabled === false) return { attributed: false, reason: "DISABLED" };
    if (!code) return { attributed: false, reason: "NO_CODE" };

    const normalised = String(code).toUpperCase().trim();
    const referrer = await User.findOne({ referralCode: normalised })
      .select("_id firstName lastName email status deletedAt phoneE164 phoneVerifiedAt")
      .lean();

    if (!referrer) return { attributed: false, reason: "UNKNOWN_CODE" };

    // Self-referral, in the two ways it actually happens: the same account, or
    // the same person signing up again with a second address.
    if (String(referrer._id) === String(refereeUserId)) {
      return { attributed: false, reason: "SELF_REFERRAL" };
    }

    const referee = await User.findById(refereeUserId)
      .select("_id firstName lastName email phoneE164 phoneVerifiedAt")
      .lean();
    if (!referee) return { attributed: false, reason: "NO_REFEREE" };

    // Checked here as well as enforced by the unique index below. The index is
    // the guarantee against two concurrent registrations; this is the one that
    // works on a collection whose index is still being built, and the one that
    // gives a clear answer rather than a duplicate-key error.
    const already = await Referral.exists({ refereeUserId: referee._id });
    if (already) return { attributed: false, reason: "ALREADY_REFERRED" };

    const flags = await assessRisk({ referrer, referee, settings });
    if (flags.includes(REFERRAL_RISK_FLAGS.SELF_REFERRAL)) {
      return { attributed: false, reason: "SELF_REFERRAL" };
    }

    const referral = await Referral.create({
      referrerUserId: referrer._id,
      refereeUserId: referee._id,
      code: normalised,
      status: REFERRAL_STATUS.PENDING,
      riskFlags: flags,
      signupIpHash: ip ? hashIp(ip) : undefined,
    });

    await notify({
      userId: referrer._id,
      type: NOTIFICATION_TYPES.REFERRAL_JOINED,
      title: "Someone joined with your code",
      body:
        (settings.referrals?.referrerRewardCents ?? 0) > 0
          ? `You'll earn ${formatMoney(settings.referrals.referrerRewardCents)} credit once they've taken their first lessons.`
          : "We'll let you know how they get on.",
      href: "/referrals",
      entityType: "Referral",
      entityId: referral._id,
    });

    await recordAudit({
      actor: { id: refereeUserId },
      action: AUDIT_ACTIONS.REFERRAL_ATTRIBUTED,
      entityType: "Referral",
      entityId: referral._id,
      metadata: { code: normalised, flags },
    });

    return { attributed: true, referralId: String(referral._id), flags };
  } catch (error) {
    // The unique index on the referee is the real guarantee; hitting it means
    // this account was already introduced by somebody.
    if (error?.code === 11000) return { attributed: false, reason: "ALREADY_REFERRED" };

    console.error("[referral] attribution failed:", error.message);
    return { attributed: false, reason: "ERROR" };
  }
}

/**
 * Signals worth a human's attention.
 *
 * Deliberately conservative about what is *blocking*: only a referral that is
 * plainly the same person is refused outright. Everything else is recorded
 * and left for an administrator, because the requirements define no penalties
 * and a false positive here costs a real customer their reward.
 */
async function assessRisk({ referrer, referee, settings }) {
  const flags = [];

  if (String(referrer.email).toLowerCase() === String(referee.email).toLowerCase()) {
    flags.push(REFERRAL_RISK_FLAGS.SELF_REFERRAL);
  }

  // A confirmed mobile number is a real-world identity, so two accounts
  // sharing one is the strongest signal available without being invasive.
  if (
    referrer.phoneVerifiedAt &&
    referee.phoneVerifiedAt &&
    referrer.phoneE164 &&
    referrer.phoneE164 === referee.phoneE164
  ) {
    flags.push(REFERRAL_RISK_FLAGS.SHARED_PHONE);
  }

  if (referrer.status !== USER_STATUS.ACTIVE || referrer.deletedAt) {
    flags.push(REFERRAL_RISK_FLAGS.REFERRER_INACTIVE);
  }

  const recent = await Referral.countDocuments({
    referrerUserId: referrer._id,
    createdAt: { $gte: addDays(new Date(), -1) },
  });
  if (recent >= 5) flags.push(REFERRAL_RISK_FLAGS.RAPID_SIGNUPS);

  const rewarded = await Referral.countDocuments({
    referrerUserId: referrer._id,
    status: REFERRAL_STATUS.REWARDED,
    rewardedAt: { $gte: addDays(new Date(), -365) },
  });
  if (rewarded >= (settings.referrals?.maxRewardsPerReferrer ?? 25)) {
    flags.push(REFERRAL_RISK_FLAGS.REWARD_CAP_REACHED);
  }

  return flags;
}

/** Enough to spot a farm; never enough to be an address. */
function hashIp(ip) {
  return createHash("sha256").update(`aplus:referral:${ip}`).digest("hex").slice(0, 32);
}

// --- Qualifying ------------------------------------------------------------

/**
 * Has this account's referral earned its reward yet?
 *
 * Called after a lesson is completed. Counts completed, paid lessons — not
 * bookings, not confirmations — because those are the only ones that cost an
 * attacker anything.
 *
 * Idempotent: a referral already rewarded is left alone, and the credit grant
 * carries its own idempotency key beneath that.
 */
export async function qualifyReferralFor(refereeUserId) {
  const settings = await getSettings();
  if (settings.referrals?.enabled === false) return { qualified: false, reason: "DISABLED" };

  const referral = await Referral.findOne({
    refereeUserId,
    status: REFERRAL_STATUS.PENDING,
  });
  if (!referral) return { qualified: false, reason: "NOTHING_PENDING" };

  const required = settings.referrals?.qualifyingLessons ?? 1;
  const lessons = await Booking.find({
    purchaserId: refereeUserId,
    status: BOOKING_STATUS.COMPLETED,
  })
    .select("_id")
    .limit(required)
    .lean();

  if (lessons.length < required) {
    return { qualified: false, reason: "NOT_ENOUGH_LESSONS", lessons: lessons.length };
  }

  // The referrer must still be an account in good standing when the reward
  // lands, not only when the code was used.
  const referrer = await User.findById(referral.referrerUserId)
    .select("status deletedAt firstName")
    .lean();
  const referrerUsable = referrer && referrer.status === USER_STATUS.ACTIVE && !referrer.deletedAt;

  const capped = referral.riskFlags?.includes(REFERRAL_RISK_FLAGS.REWARD_CAP_REACHED);

  // Claim it. Whichever call gets here second finds nothing PENDING.
  const claimed = await Referral.updateOne(
    { _id: referral._id, status: REFERRAL_STATUS.PENDING },
    {
      $set: {
        status: REFERRAL_STATUS.QUALIFIED,
        qualifiedAt: new Date(),
        qualifyingBookingIds: lessons.map((l) => l._id),
        qualifyingLessons: lessons.length,
      },
    },
  );
  if (!claimed.modifiedCount) return { qualified: false, reason: "ALREADY_CLAIMED" };

  const referrerReward = referrerUsable && !capped
    ? (settings.referrals?.referrerRewardCents ?? 0)
    : 0;
  const refereeReward = settings.referrals?.refereeRewardCents ?? 0;

  const grants = [];
  if (referrerReward > 0) {
    grants.push(
      grantCredit({
        userId: referral.referrerUserId,
        amountCents: referrerReward,
        reason: CREDIT_REASONS.REFERRAL_REWARD,
        referralId: referral._id,
        note: "Thank you for introducing a new family.",
        idempotencyKey: `referral-referrer:${referral._id}`,
      }),
    );
  }
  if (refereeReward > 0) {
    grants.push(
      grantCredit({
        userId: refereeUserId,
        amountCents: refereeReward,
        reason: CREDIT_REASONS.REFERRAL_WELCOME,
        referralId: referral._id,
        note: "Welcome credit for joining through a referral.",
        idempotencyKey: `referral-referee:${referral._id}`,
      }),
    );
  }
  await Promise.all(grants);

  await Referral.updateOne(
    { _id: referral._id },
    {
      $set: {
        status: REFERRAL_STATUS.REWARDED,
        rewardedAt: new Date(),
        referrerRewardCents: referrerReward,
        refereeRewardCents: refereeReward,
      },
    },
  );

  if (referrerReward > 0) {
    await notify({
      userId: referral.referrerUserId,
      type: NOTIFICATION_TYPES.REFERRAL_REWARDED,
      title: `You've earned ${formatMoney(referrerReward)} credit`,
      body: "Someone you introduced has taken their first lessons. Thank you.",
      href: "/referrals",
      entityType: "Referral",
      entityId: referral._id,
    });
  }

  await recordAudit({
    actor: { role: "SYSTEM" },
    action: AUDIT_ACTIONS.REFERRAL_QUALIFIED,
    entityType: "Referral",
    entityId: referral._id,
    metadata: { referrerReward, refereeReward, capped, referrerUsable },
  });

  return { qualified: true, referrerReward, refereeReward };
}

/**
 * Undo a referral whose qualifying lesson was refunded.
 *
 * Called when a booking that earned a reward is refunded, and available to an
 * administrator by hand. The claw-back is bounded by what is left in each
 * balance: credit already spent on a lesson that went ahead is gone, and
 * pushing an account into debt would be a worse outcome than writing the
 * difference off visibly.
 */
export async function reverseReferral(referralId, { reason }, actor) {
  const referral = await Referral.findById(referralId);
  if (!referral) throw new NotFoundError("That referral no longer exists.");

  if (referral.status === REFERRAL_STATUS.REVERSED) {
    throw new ConflictError("That referral has already been reversed.");
  }

  const recovered = { referrer: null, referee: null };

  if (referral.referrerRewardCents > 0) {
    recovered.referrer = await clawBackCredit({
      userId: referral.referrerUserId,
      amountCents: referral.referrerRewardCents,
      reason: CREDIT_REASONS.REFERRAL_REVERSAL,
      referralId: referral._id,
      note: reason ?? "The qualifying lesson was refunded.",
      createdBy: actor?.id,
    });
  }
  if (referral.refereeRewardCents > 0) {
    recovered.referee = await clawBackCredit({
      userId: referral.refereeUserId,
      amountCents: referral.refereeRewardCents,
      reason: CREDIT_REASONS.REFERRAL_REVERSAL,
      referralId: referral._id,
      note: reason ?? "The qualifying lesson was refunded.",
      createdBy: actor?.id,
    });
  }

  referral.status = REFERRAL_STATUS.REVERSED;
  referral.reversedAt = new Date();
  referral.reversedBy = actor?.id;
  referral.reversalReason = reason;
  await referral.save();

  await recordAudit({
    actor: actor ?? { role: "SYSTEM" },
    action: AUDIT_ACTIONS.REFERRAL_REVERSED,
    entityType: "Referral",
    entityId: referral._id,
    metadata: { reason, recovered },
  });

  return { ...toPlain(referral), recovered };
}

/**
 * A booking was refunded — reverse any referral it earned.
 *
 * Wired into the refund path so the reversal is a consequence of the refund
 * rather than something somebody has to remember.
 */
export async function reverseReferralsForBooking(bookingId, { reason } = {}) {
  const referrals = await Referral.find({
    qualifyingBookingIds: bookingId,
    status: REFERRAL_STATUS.REWARDED,
  })
    .select("_id")
    .lean();

  let reversed = 0;
  for (const referral of referrals) {
    await reverseReferral(referral._id, {
      reason: reason ?? "A qualifying lesson was refunded.",
    }).catch((error) => {
      console.warn("[referral] reversal failed:", error.message);
      return null;
    });
    reversed += 1;
  }
  return { reversed };
}

// --- Reads -----------------------------------------------------------------

/** What a person sees on their own referrals page. */
export async function referralSummary(actor) {
  const settings = await getSettings();
  const code = await getOrCreateReferralCode(actor.id);

  const [referrals, counts, referredBy] = await Promise.all([
    Referral.find({ referrerUserId: actor.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("refereeUserId", "firstName lastName createdAt")
      .lean(),
    Referral.aggregate([
      { $match: { referrerUserId: asObjectId(actor.id) } },
      { $group: { _id: "$status", count: { $sum: 1 }, earned: { $sum: "$referrerRewardCents" } } },
    ]),
    Referral.findOne({ refereeUserId: actor.id })
      .populate("referrerUserId", "firstName lastName")
      .lean(),
  ]);

  const byStatus = Object.fromEntries(counts.map((row) => [row._id, row.count]));
  const earnedCents = counts.reduce(
    (sum, row) => (row._id === REFERRAL_STATUS.REWARDED ? sum + row.earned : sum),
    0,
  );

  return {
    code,
    enabled: settings.referrals?.enabled !== false,
    rewards: {
      referrerRewardCents: settings.referrals?.referrerRewardCents ?? 0,
      refereeRewardCents: settings.referrals?.refereeRewardCents ?? 0,
      qualifyingLessons: settings.referrals?.qualifyingLessons ?? 1,
    },
    stats: {
      joined: referrals.length,
      pending: byStatus[REFERRAL_STATUS.PENDING] ?? 0,
      rewarded: byStatus[REFERRAL_STATUS.REWARDED] ?? 0,
      reversed: byStatus[REFERRAL_STATUS.REVERSED] ?? 0,
      earnedCents,
    },
    // Names are first name plus initial, as everywhere else on the platform:
    // a referral page is not a reason to learn somebody's surname (§35).
    referrals: referrals.map((referral) => ({
      id: String(referral._id),
      status: referral.status,
      name: referral.refereeUserId
        ? publicName(referral.refereeUserId.firstName, referral.refereeUserId.lastName)
        : "A new member",
      joinedAt: referral.createdAt,
      rewardedAt: referral.rewardedAt ?? null,
      rewardCents: referral.referrerRewardCents ?? 0,
    })),
    referredBy: referredBy?.referrerUserId
      ? publicName(referredBy.referrerUserId.firstName, referredBy.referrerUserId.lastName)
      : null,
  };
}

/** Every referral, for the admin review queue (§41 Phase 2). */
export async function listAllReferrals({ status, flagged, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;
  if (flagged) query["riskFlags.0"] = { $exists: true };

  const [items, total, flaggedCount] = await Promise.all([
    Referral.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("referrerUserId", "firstName lastName email status")
      .populate("refereeUserId", "firstName lastName email createdAt")
      .lean(),
    Referral.countDocuments(query),
    Referral.countDocuments({ "riskFlags.0": { $exists: true }, status: { $ne: REFERRAL_STATUS.REVERSED } }),
  ]);

  return { items: toPlain(items), total, flaggedCount, page, pageSize: size };
}

/** `aggregate` does not cast its match values the way `find` does. */
function asObjectId(value) {
  return new Types.ObjectId(String(value));
}
