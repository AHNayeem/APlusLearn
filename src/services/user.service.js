import "server-only";
import {
  User,
  StudentProfile,
  TutorProfile,
  TutorApplication,
  Booking,
  Payment,
  Conversation,
  Favourite,
  Notification,
  TutorRequest,
  TrustedDevice,
  AuthToken,
} from "@/models";
import {
  USER_STATUS, BLOCKED_USER_STATUSES, ROLES, BOOKING_STATUS, PAYMENT_STATUS, AUDIT_ACTIONS,
  PAGE_SIZES, NOTIFICATION_CHANNELS, AVATAR_IMAGE, TUTOR_STATUS, REQUEST_STATUS,
} from "@/constants";
import {
  NotFoundError, BusinessRuleError, AuthenticationError, ValidationError,
} from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { verifyPassword } from "@/lib/auth/password";
import { escapeRegex } from "@/lib/security/sanitize";
import { validateImage, extensionFor } from "@/lib/images/inspect";
import {
  getStorageProvider,
  getStorageProviderForRead,
  STORAGE_SCOPES,
} from "./external/storage-provider";
import { geocode } from "./external/geocoding-provider";
import { recordAudit } from "./audit.service";
import { revokeAllSessions } from "./auth.service";
import { refreshCourseTutorCounts } from "./curriculum.service";
// Namespace imports, read at call time: both functions belong to another
// service, and a missing export must surface as a clear error at the moment
// it matters rather than as a module that fails to load.
import * as tutorService from "./tutor.service";
import * as verificationService from "./verification.service";

/** Account management and the admin user directory (§8, §24, §35). */

export async function getUser(id) {
  const user = await User.findById(id).lean();
  if (!user) throw new NotFoundError("We couldn't find that account.");
  return toPlain({ ...user, passwordHash: undefined });
}

export async function updateProfile(userId, patch) {
  const update = compact(patch);

  if (update.postalCode || update.city) {
    const geo = await geocode({
      postalCode: update.postalCode,
      city: update.city,
      province: update.province,
    });
    if (geo) update.location = { type: "Point", coordinates: geo.coordinates };
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: update },
    { returnDocument: "after", runValidators: true },
  ).lean();

  if (!user) throw new NotFoundError("We couldn't find that account.");

  // A tutor's display name and city also appear on their public profile.
  if (user.role === ROLES.TUTOR) {
    await TutorProfile.updateOne(
      { userId },
      { $set: compact({ city: update.city, province: update.province, timeZone: update.timeZone }) },
    );
  }

  return toPlain({ ...user, passwordHash: undefined });
}

export async function updateNotificationPreferences(userId, preferences) {
  const update = Object.fromEntries(
    Object.entries(preferences)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [`notificationPreferences.${k}`, v]),
  );

  // Switching the text channel on is a claim about a number, so it is checked
  // against the account rather than taken from the request: a preference
  // cannot be the thing that authorises texting an unconfirmed handset, and
  // it can never override a STOP the carrier forwarded (§36, §41 Phase 2).
  if (preferences[NOTIFICATION_CHANNELS.SMS] === true) {
    const account = await User.findById(userId)
      .select("phoneE164 phoneVerifiedAt smsOptOutAt")
      .lean();
    if (!account) throw new NotFoundError("We couldn't find that account.");

    if (!account.phoneE164 || !account.phoneVerifiedAt) {
      throw new BusinessRuleError(
        "Confirm a mobile number before turning text messages on.",
        "PHONE_NOT_VERIFIED",
      );
    }
    if (account.smsOptOutAt) {
      throw new BusinessRuleError(
        "This number replied STOP. Text START to our number to receive messages again.",
        "SMS_OPTED_OUT",
      );
    }
  }

  const user = await User.findByIdAndUpdate(userId, { $set: update }, { returnDocument: "after" }).lean();
  if (!user) throw new NotFoundError("We couldn't find that account.");
  return toPlain(user.notificationPreferences);
}

/**
 * Account deletion, by the member (§35, R30.10).
 *
 * The password is the member's proof; everything after it is the same
 * anonymisation an administrator's DELETE runs (`anonymiseAccount`), so the
 * two paths cannot drift into deleting different amounts.
 */
export async function deleteAccount(userId, { password }, request) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new NotFoundError("We couldn't find that account.");

  if (user.passwordHash) {
    const valid = await verifyPassword(password ?? "", user.passwordHash);
    if (!valid) throw new AuthenticationError("Your password is incorrect.");
  }

  return anonymiseAccount(userId, { actor: { id: userId, role: user.role }, by: "self", request });
}

/** What a deleted account is called wherever it is still referenced. */
export const DELETED_USER_NAME = { firstName: "Deleted", lastName: "user" };
/** What a deleted family's learner is called in the other party's history. */
export const DELETED_LEARNER_NAME = { firstName: "Former learner", lastName: "" };

/**
 * A unique address that can never receive mail: `.invalid` is reserved by
 * RFC 2606 for exactly this, so an anonymised row cannot collide with a real
 * account and nothing sent to it can reach anybody.
 */
export function deletedEmailFor(userId) {
  return `deleted-${userId}@deleted.invalid`;
}

/**
 * The one anonymisation routine (§35, R30.10, audit S9).
 *
 * Used by self-deletion and by an administrator's DELETE alike. Financial and
 * lesson records survive — accounting needs them, and the other party's
 * history is theirs — but nothing on them can be traced back to a person:
 * the account they point at is "Deleted user" at an undeliverable address,
 * and the free text written about or by this account is removed.
 *
 * What goes, and why each one:
 *
 *   - the account's own PII: name, email, phone (both forms), postal code,
 *     city, province, coordinates, photo (and its stored bytes), linked
 *     sign-in identities, the payment-provider customer reference, password;
 *   - every session and trusted device (`tokenVersion` bump, rows removed),
 *     and any outstanding sign-in / reset codes;
 *   - the family's learners: names, school, birth year, marks, goals,
 *     accessibility needs and notes — often a child's, and the most
 *     sensitive thing the platform holds about anyone;
 *   - a tutor's public profile: unpublished, and its bio, headline, gallery,
 *     video, education, experience and OCT number cleared; its application
 *     answers removed; its verification document *bytes* discarded;
 *   - free text on their tutor requests, and the street address / notes on
 *     their lessons' locations;
 *   - favourites and notifications, which exist only for this account.
 *
 * What stays: bookings, payments, payouts, reviews and messages, attached to
 * the anonymised account. A message the deleted member sent still reads as
 * the thread the other party had — from "Deleted user".
 *
 * Refused while confirmed lessons are still ahead: cancelling them is a
 * money decision (the cancellation policy, refunds) that deletion must not
 * take silently on anybody's behalf.
 */
export async function anonymiseAccount(userId, { actor, by, reason, request } = {}) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("We couldn't find that account.");
  if (user.status === USER_STATUS.DELETED || user.deletedAt) {
    throw new BusinessRuleError("This account has already been deleted.", "ALREADY_DELETED");
  }

  await assertNotLastAdmin(user, "delete");

  const upcoming = await Booking.countDocuments({
    $or: [{ purchaserId: user._id }, { tutorUserId: user._id }],
    status: BOOKING_STATUS.CONFIRMED,
    startAt: { $gte: new Date() },
  });
  if (upcoming > 0) {
    const whose = by === "self" ? "You have" : "This account has";
    throw new BusinessRuleError(
      `${whose} ${upcoming} upcoming lesson${upcoming === 1 ? "" : "s"}. Cancel ${upcoming === 1 ? "it" : "them"} before deleting the account.`,
      "HAS_UPCOMING_BOOKINGS",
    );
  }

  // Identity documents first: if they cannot be discarded the deletion stops
  // here, with the account intact, rather than finishing and leaving a
  // passport scan behind an account nobody can name any more.
  if (user.role === ROLES.TUTOR) {
    const discard = verificationService.discardVerificationDocuments;
    if (typeof discard !== "function") {
      throw new Error(
        "verification.service does not export discardVerificationDocuments — identity documents " +
          "cannot be removed, so the account was not deleted.",
      );
    }
    await discard({ userId: user._id });
  }

  // Read before the fields are cleared — afterwards nothing on the record
  // says which stored object this account owned.
  const photoKey = user.avatar?.storageKey;
  const wasSearchable = Boolean(
    await TutorProfile.exists({ userId: user._id, isSearchable: true }),
  );
  const now = new Date();

  Object.assign(user, {
    ...DELETED_USER_NAME,
    email: deletedEmailFor(user._id),
    phone: undefined,
    phoneE164: undefined,
    phoneVerifiedAt: null,
    avatarUrl: undefined,
    avatar: undefined,
    passwordHash: undefined,
    city: undefined,
    province: undefined,
    postalCode: undefined,
    location: undefined,
    oauthAccounts: [],
    paymentCustomerId: undefined,
    referralCode: undefined,
    marketingOptIn: false,
    status: USER_STATUS.DELETED,
    statusReason: reason,
    statusChangedAt: now,
    statusChangedBy: actor?.id ?? user._id,
    deletedAt: now,
    tokenVersion: (user.tokenVersion ?? 0) + 1,
  });
  await user.save();

  // The photo is a picture of the person: erasing it is the point, not
  // housekeeping. Best-effort all the same — the record no longer points at it.
  await discardAvatarObject(photoKey);

  const ownerId = user._id;
  await Promise.all([
    TrustedDevice.deleteMany({ userId: ownerId }),
    AuthToken.deleteMany({ userId: ownerId }),
    Favourite.deleteMany({ userId: ownerId }),
    Notification.deleteMany({ userId: ownerId }),

    // Learners: kept as rows (bookings and reports point at them), emptied of
    // everything that says who the child is.
    StudentProfile.updateMany(
      { ownerId },
      {
        $set: { ...DELETED_LEARNER_NAME, learningGoals: [], archivedAt: now, shareFullNameWithTutor: false },
        $unset: {
          avatarUrl: "", birthYear: "", school: "", currentMark: "", targetMark: "",
          areasForImprovement: "", learningPreferences: "", notes: "", accessibilityNeeds: "",
        },
      },
    ),

    // A tutor's public profile is unpublished and emptied. The slug carried
    // the tutor's name in its URL, so it goes too.
    TutorProfile.updateOne(
      { userId: ownerId },
      {
        $set: {
          isSearchable: false,
          status: TUTOR_STATUS.SUSPENDED,
          slug: `deleted-${ownerId}`,
          gallery: [],
          education: [],
          experience: [],
        },
        $unset: { headline: "", bio: "", introVideoUrl: "", octNumber: "" },
      },
    ),
    TutorApplication.updateMany({ userId: ownerId }, { $set: { data: {} } }),

    // Requests: open ones close; every one loses its free text and its
    // precise location (the city stays — it is a place, not a person).
    TutorRequest.updateMany(
      { ownerId, status: REQUEST_STATUS.OPEN },
      { $set: { status: REQUEST_STATUS.CLOSED, closedAt: now } },
    ),
    TutorRequest.updateMany(
      { ownerId },
      { $unset: { title: "", goal: "", notes: "", closeReason: "", postalCode: "", location: "" } },
    ),

    // Lessons stay for accounting; the address they were held at (often the
    // family's home) and the notes this account wrote on them do not.
    Booking.updateMany(
      { purchaserId: ownerId },
      { $unset: { "location.addressLine": "", "location.postalCode": "", "location.notes": "", studentNotes: "" } },
    ),
    Booking.updateMany(
      { tutorUserId: ownerId },
      { $unset: { "location.addressLine": "", "location.postalCode": "", "location.notes": "", tutorNotes: "" } },
    ),

    // Threads stay readable for the other party; the deleted member's copy
    // is archived.
    Conversation.updateMany({ participantIds: ownerId }, { $addToSet: { archivedBy: ownerId } }),
  ]);

  if (wasSearchable) {
    await refreshCourseTutorCounts().catch((error) =>
      console.warn("[account] could not refresh course tutor counts:", error.message),
    );
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.USER_DELETED,
    entityType: "User",
    entityId: ownerId,
    metadata: { by, reason, anonymised: true },
    request,
  });

  return { deleted: true };
}

// --- Profile photo (§8, §16) -----------------------------------------------

/**
 * The public path an uploaded photo is served at.
 *
 * Derived, never stored twice over: one function means the route, the stored
 * pointer and any future consumer cannot drift. The key is the whole of the
 * path because the key is a UUID this application generated — it carries no
 * name, no account id and no date, so the URL itself discloses nothing about
 * whose face is in the picture.
 */
export function avatarPath(storageKey) {
  return `/api/avatars/${storageKey}`;
}

/**
 * Replace this account's profile photo (§8, §16).
 *
 * Everything the upload claims about itself is discarded. The format comes
 * from the container's own magic bytes, the extension from the format, and the
 * stored name from a UUID — so a script called `me.png` and declared
 * `image/png` is refused on what it *is*, and an uploader's filename never
 * becomes a path. This is the same inspection the branding uploads run, for
 * the same reason.
 *
 * The order matters and is the whole of the replacement rule:
 *
 *   1. inspect, then store the new object;
 *   2. point the account at it, capturing the previous reference in the same
 *      atomic update — `returnDocument: "before"` is what makes "which file
 *      was this replacing" a fact rather than a second read that could race
 *      another upload;
 *   3. only then delete the old object.
 *
 * So a failure at (1) or (2) leaves the existing photo exactly as it was —
 * the account is never left pointing at nothing — and a failure at (3) leaves
 * one unreferenced object behind, which costs bytes and breaks nothing. If (2)
 * fails after (1) succeeded, the object we just wrote is discarded rather than
 * orphaned.
 */
export async function uploadAvatar(userId, file) {
  if (!file || typeof file === "string") {
    throw new ValidationError({ fieldErrors: { file: ["Choose a photo to upload."] } });
  }

  // Checked before the bytes are read, so an oversized upload is refused
  // without being pulled into memory first.
  if (file.size > AVATAR_IMAGE.maxBytes) {
    throw new BusinessRuleError(
      `Your photo must be smaller than ${Math.round(AVATAR_IMAGE.maxBytes / 1024 / 1024)} MB.`,
      "FILE_TOO_LARGE",
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const inspection = validateImage(buffer, AVATAR_IMAGE);
  if (!inspection.ok) throw new BusinessRuleError(inspection.reason, "UNSUPPORTED_FILE_TYPE");

  const stored = await (await getStorageProvider()).put({
    buffer,
    scope: STORAGE_SCOPES.AVATARS,
    contentType: inspection.contentType,
    extension: extensionFor(inspection.contentType),
  });

  const avatar = {
    storageKey: stored.storageKey,
    contentType: inspection.contentType,
    sizeBytes: stored.sizeBytes,
    width: inspection.width,
    height: inspection.height,
    uploadedAt: new Date(),
  };

  let previous;
  try {
    previous = await User.findByIdAndUpdate(
      userId,
      { $set: { avatar, avatarUrl: avatarPath(stored.storageKey) } },
      { returnDocument: "before" },
    )
      .select("avatar")
      .lean();
  } catch (error) {
    // The account still points at whatever it pointed at before, so the
    // object just written belongs to nobody. Take it back out.
    await discardAvatarObject(avatar.storageKey);
    throw error;
  }

  if (!previous) {
    await discardAvatarObject(avatar.storageKey);
    throw new NotFoundError("We couldn't find that account.");
  }

  await discardAvatarObject(previous.avatar?.storageKey, { unless: avatar.storageKey });

  return getUser(userId);
}

/**
 * Remove the photo, whichever kind it is.
 *
 * `avatarUrl` is cleared as well as `avatar`, so an account that arrived with
 * a picture from Google can take it down too — a person asking us to stop
 * showing their face means that, not "stop showing the copy you happen to
 * host".
 */
export async function removeAvatar(userId) {
  const previous = await User.findByIdAndUpdate(
    userId,
    { $unset: { avatar: "", avatarUrl: "" } },
    { returnDocument: "before" },
  )
    .select("avatar")
    .lean();

  if (!previous) throw new NotFoundError("We couldn't find that account.");

  await discardAvatarObject(previous.avatar?.storageKey);

  return getUser(userId);
}

/**
 * Best-effort cleanup of a replaced photo.
 *
 * Two guards, and both are about not deleting somebody else's file. The key
 * must not be the one we have just started using, and no account may still be
 * pointing at it — `avatar.storageKey` is uniquely indexed, so that count is
 * the ownership rule rather than an assumption about it. A failure here is
 * logged and swallowed: an unreferenced object is litter, but an exception
 * would undo a photo change that has already succeeded.
 */
async function discardAvatarObject(storageKey, { unless } = {}) {
  if (!storageKey || storageKey === unless) return;

  try {
    const stillReferenced = await User.countDocuments({ "avatar.storageKey": storageKey });
    if (stillReferenced > 0) return;

    await (await getStorageProvider()).remove({
      storageKey,
      scope: STORAGE_SCOPES.AVATARS,
    });
  } catch (error) {
    console.warn("[avatar] could not remove replaced photo:", error.message);
  }
}

/**
 * Read one profile photo for serving (§8).
 *
 * The caller names a storage key, so the first thing this does is turn that
 * key back into the *account currently holding it*. Only a key that is
 * somebody's avatar right now resolves at all: a verification document's key
 * is not one, a key from a photo that has since been replaced is not one, and
 * a guessed key is not one. That lookup is what stops this route being a
 * general reader for the object store.
 *
 * Who may see it is then a property of the account, not of the request. A
 * tutor's photo is marketplace content — it is on the public search results
 * and profile pages that anonymous visitors and link-preview bots load, so
 * refusing it here would break those pages rather than protect anyone.
 * Everybody else's is shown only to people they already deal with, so it
 * needs a session; the key stays unguessable either way.
 */
export async function readAvatar(storageKey, viewer) {
  const owner = await User.findOne({ "avatar.storageKey": storageKey })
    .select("avatar role")
    .lean();

  if (!owner?.avatar?.storageKey) throw new NotFoundError("That photo is not available.");

  const isPublic = owner.role === ROLES.TUTOR;
  if (!isPublic && !viewer) throw new AuthenticationError();

  const body = await (await getStorageProviderForRead()).get({
    storageKey: owner.avatar.storageKey,
    scope: STORAGE_SCOPES.AVATARS,
  });

  return { body, contentType: owner.avatar.contentType, uploadedAt: owner.avatar.uploadedAt, isPublic };
}

// --- Admin directory -------------------------------------------------------

export async function listUsers({ q, role, status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};

  if (role) query.role = role;
  if (status) query.status = status;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    query.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }];
  }

  const [items, total] = await Promise.all([
    User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean(),
    User.countDocuments(query),
  ]);

  return {
    items: toPlain(items).map((u) => ({ ...u, passwordHash: undefined })),
    total,
    page,
    pageSize: size,
  };
}

/** Payments that represent money genuinely taken, whatever happened next. */
const SETTLED_PAYMENT_STATUSES = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_STATUS.REFUNDED,
];

const HISTORY_PAGE_SIZE = 10;

/**
 * One account, with the history an administrator may review (R28.3).
 *
 * Lessons (as the purchaser or as the tutor), payments (as the payer or the
 * payee), and conversations — each paged independently, so a long-standing
 * account is reviewable rather than truncated. Conversations are listed by
 * who and when only: no message body and no preview leaves this function.
 * Reading a thread is a separate, audited act that the moderation queue
 * performs on a *reported* conversation (§35, audit S8).
 *
 * Lifetime spend is money, so it comes from `Payment`, net of refunds — what
 * this account was actually charged and kept being charged — never from a
 * sum of booking prices, which would count abandoned checkouts and refunded
 * lessons as spend.
 */
export async function getUserDetail(
  id,
  { bookingsPage = 1, paymentsPage = 1, conversationsPage = 1, pageSize = HISTORY_PAGE_SIZE } = {},
) {
  const user = await User.findById(id).lean();
  if (!user) throw new NotFoundError("We couldn't find that account.");

  const bookingQuery = { $or: [{ purchaserId: user._id }, { tutorUserId: user._id }] };
  const paymentQuery = { $or: [{ purchaserId: user._id }, { tutorUserId: user._id }] };
  const conversationQuery = { participantIds: user._id };

  const [
    tutorProfile, students, bookingCount, bookings, paymentCount, payments,
    conversationCount, conversations, money,
  ] = await Promise.all([
    TutorProfile.findOne({ userId: id }).lean(),
    StudentProfile.find({ ownerId: id }).lean(),
    Booking.countDocuments(bookingQuery),
    Booking.find(bookingQuery)
      .select(
        "reference purchaserId tutorUserId studentProfileId courseCode courseName mode startAt " +
          "durationMinutes status price.totalCents paymentId packagePurchaseId groupSessionId",
      )
      .sort({ startAt: -1, _id: -1 })
      .skip((bookingsPage - 1) * pageSize)
      .limit(pageSize)
      .populate("studentProfileId", "firstName lastName")
      .populate("tutorUserId", "firstName lastName")
      .populate("purchaserId", "firstName lastName")
      .lean(),
    Payment.countDocuments(paymentQuery),
    Payment.find(paymentQuery)
      .select(
        "receiptNumber purchaserId tutorUserId bookingId packagePurchaseId status subtotalCents " +
          "totalCents refundedCents creditAppliedCents currency paidAt createdAt",
      )
      .sort({ createdAt: -1, _id: -1 })
      .skip((paymentsPage - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Conversation.countDocuments(conversationQuery),
    Conversation.find(conversationQuery)
      // Deliberately not `lastMessagePreview`: that is message content.
      .select("participantIds learnerUserId tutorUserId lastMessageAt reportStatus blockedBy createdAt")
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip((conversationsPage - 1) * pageSize)
      .limit(pageSize)
      .populate("learnerUserId", "firstName lastName role status")
      .populate("tutorUserId", "firstName lastName role status")
      .lean(),
    Payment.aggregate([
      { $match: { purchaserId: user._id, status: { $in: SETTLED_PAYMENT_STATUSES } } },
      {
        $group: {
          _id: null,
          charged: { $sum: "$totalCents" },
          refunded: { $sum: { $ifNull: ["$refundedCents", 0] } },
          payments: { $sum: 1 },
        },
      },
    ]),
  ]);

  const spend = money[0] ?? { charged: 0, refunded: 0, payments: 0 };
  const page = (number, total) => ({
    page: number,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });

  return {
    user: toPlain({ ...user, passwordHash: undefined }),
    tutorProfile: tutorProfile ? toPlain(tutorProfile) : null,
    students: toPlain(students),
    bookingCount,
    /** Charged on settled payments, less what was refunded (R28.3). */
    lifetimeSpendCents: spend.charged - spend.refunded,
    lifetimeRefundedCents: spend.refunded,
    paidPayments: spend.payments,
    history: {
      bookings: { items: toPlain(bookings), ...page(bookingsPage, bookingCount) },
      payments: { items: toPlain(payments), ...page(paymentsPage, paymentCount) },
      conversations: {
        items: toPlain(conversations).map((c) => ({
          id: c.id,
          learner: c.learnerUserId ?? null,
          tutor: c.tutorUserId ?? null,
          lastMessageAt: c.lastMessageAt,
          createdAt: c.createdAt,
          reportStatus: c.reportStatus ?? null,
          blocked: (c.blockedBy ?? []).length > 0,
        })),
        ...page(conversationsPage, conversationCount),
      },
    },
  };
}

/**
 * An administrator may not remove the last administrator who can act (S14).
 *
 * "Active" is the status, not merely "not deleted": a platform whose only
 * other administrator is suspended has nobody to reinstate anybody.
 */
async function assertNotLastAdmin(target, verb) {
  if (target.role !== ROLES.ADMIN) return;
  const others = await User.countDocuments({
    _id: { $ne: target._id },
    role: ROLES.ADMIN,
    status: USER_STATUS.ACTIVE,
    deletedAt: null,
  });
  if (others === 0) {
    throw new BusinessRuleError(
      `You cannot ${verb} the last active administrator. Appoint another administrator first.`,
      "LAST_ADMIN",
    );
  }
}

/**
 * Keep a tutor's place in search in step with their account (§42).
 *
 * The rule is engineer B's, in `tutor.service` — this only asks for it to be
 * applied once the account's status has changed. A build without it is
 * reported plainly rather than leaving a suspended tutor bookable.
 */
async function syncTutorSearchState(userId) {
  const sync = tutorService.syncSearchableForUser;
  if (typeof sync !== "function") {
    throw new Error(
      "tutor.service does not export syncSearchableForUser — the tutor's search listing was not " +
        "updated to match this account change.",
    );
  }
  await sync(userId);
}

/** Admin actions, their audit names, and who may be on the receiving end. */
const ADMIN_ACTION_AUDIT = {
  SUSPEND: AUDIT_ACTIONS.USER_SUSPENDED,
  BAN: AUDIT_ACTIONS.USER_BANNED,
  REINSTATE: AUDIT_ACTIONS.USER_REINSTATED,
  VERIFY_EMAIL: AUDIT_ACTIONS.USER_EMAIL_VERIFIED_BY_ADMIN,
  FORCE_LOGOUT: AUDIT_ACTIONS.USER_SESSIONS_REVOKED,
};

/**
 * Suspend, ban, restore, verify, sign out or delete an account (§24, R28.2).
 *
 * SUSPEND is temporary and BAN is permanent; both block sign-in, sessions and
 * the realtime stream identically (`BLOCKED_USER_STATUSES`), both store why,
 * and neither can be lifted by the member — verifying an email, resetting a
 * password or signing in with Google leave the status where it is. Only
 * REINSTATE, with a recorded reason, restores either. DELETE is the same
 * anonymisation a member's own deletion runs.
 *
 * Every action has its own audit name (S15): a forced sign-out is not a
 * reinstatement, and the log should not say it was.
 */
export async function adminUserAction(id, { action, reason }, admin, request) {
  const user = await User.findById(id);
  if (!user) throw new NotFoundError("We couldn't find that account.");

  const destructive = ["SUSPEND", "BAN", "DELETE"].includes(action);
  if (destructive && String(user._id) === String(admin.id)) {
    throw new BusinessRuleError("You cannot suspend, ban or delete your own account.", "SELF_ACTION");
  }

  if (action === "DELETE") {
    await anonymiseAccount(user._id, { actor: admin, by: "admin", reason, request });
    return getUser(user._id);
  }

  if (user.status === USER_STATUS.DELETED || user.deletedAt) {
    throw new BusinessRuleError("This account has been deleted and can no longer be changed.", "ACCOUNT_DELETED");
  }

  const previousStatus = user.status;
  const now = new Date();
  const recordStatus = (status) => {
    user.status = status;
    user.statusReason = reason;
    user.statusChangedAt = now;
    user.statusChangedBy = admin.id;
  };

  switch (action) {
    case "SUSPEND":
    case "BAN": {
      const target = action === "BAN" ? USER_STATUS.BANNED : USER_STATUS.SUSPENDED;
      if (user.status === target) {
        throw new BusinessRuleError(
          `This account is already ${target === USER_STATUS.BANNED ? "banned" : "suspended"}.`,
          "NO_CHANGE",
        );
      }
      await assertNotLastAdmin(user, action === "BAN" ? "ban" : "suspend");
      recordStatus(target);
      // Every session, device trust and open stream ends with this.
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      break;
    }

    case "REINSTATE":
      if (!BLOCKED_USER_STATUSES.includes(user.status)) {
        throw new BusinessRuleError("This account is not suspended or banned.", "NO_CHANGE");
      }
      recordStatus(user.emailVerifiedAt ? USER_STATUS.ACTIVE : USER_STATUS.PENDING_VERIFICATION);
      break;

    case "VERIFY_EMAIL":
      if (user.emailVerifiedAt) {
        throw new BusinessRuleError("This email address is already verified.", "NO_CHANGE");
      }
      user.emailVerifiedAt = now;
      // Verification activates a *pending* account and nothing else — it
      // never lifts a suspension or a ban (S7).
      if (user.status === USER_STATUS.PENDING_VERIFICATION) user.status = USER_STATUS.ACTIVE;
      break;

    case "FORCE_LOGOUT":
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      break;

    default:
      throw new BusinessRuleError("That action is not supported.");
  }

  await user.save();

  if (action === "FORCE_LOGOUT" || action === "SUSPEND" || action === "BAN") {
    // Trust is already void by `tokenVersion`; removing the rows makes the
    // next sign-in from every browser ask for an emailed code.
    await TrustedDevice.deleteMany({ userId: user._id });
  }

  await recordAudit({
    actor: admin,
    action: ADMIN_ACTION_AUDIT[action],
    entityType: "User",
    entityId: user._id,
    metadata: compact({ action, reason, previousStatus, status: user.status }),
    request,
  });

  if (["SUSPEND", "BAN", "REINSTATE"].includes(action) && user.role === ROLES.TUTOR) {
    await syncTutorSearchState(user._id);
  }

  return toPlain({ ...user.toObject(), passwordHash: undefined });
}

export { revokeAllSessions };
