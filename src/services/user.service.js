import "server-only";
import {
  User,
  StudentProfile,
  TutorProfile,
  Booking,
  Conversation,
  Favourite,
  TutorRequest,
} from "@/models";
import {
  USER_STATUS, ROLES, BOOKING_STATUS, AUDIT_ACTIONS, PAGE_SIZES, NOTIFICATION_CHANNELS,
  AVATAR_IMAGE,
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
 * Account deletion (§35).
 *
 * Financial and lesson records must survive for accounting and the other
 * party's history, so the account is anonymised and soft-deleted rather than
 * erased. Everything personally identifying is removed.
 */
export async function deleteAccount(userId, { password }, request) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new NotFoundError("We couldn't find that account.");

  if (user.passwordHash) {
    const valid = await verifyPassword(password ?? "", user.passwordHash);
    if (!valid) throw new AuthenticationError("Your password is incorrect.");
  }

  const upcomingField = user.role === ROLES.TUTOR ? "tutorUserId" : "purchaserId";
  const upcoming = await Booking.countDocuments({
    [upcomingField]: userId,
    status: BOOKING_STATUS.CONFIRMED,
    startAt: { $gte: new Date() },
  });

  if (upcoming > 0) {
    throw new BusinessRuleError(
      `You have ${upcoming} upcoming lesson${upcoming === 1 ? "" : "s"}. Cancel them before deleting your account.`,
      "HAS_UPCOMING_BOOKINGS",
    );
  }

  const anonymousEmail = `deleted-${user._id}@deleted.apluslearn.ca`;
  // Read before the fields are cleared below — afterwards there is nothing
  // left on the record to say which object this account owned.
  const photoKey = user.avatar?.storageKey;

  Object.assign(user, {
    email: anonymousEmail,
    firstName: "Deleted",
    lastName: "Account",
    phone: undefined,
    avatarUrl: undefined,
    avatar: undefined,
    passwordHash: undefined,
    city: undefined,
    postalCode: undefined,
    location: undefined,
    oauthAccounts: [],
    status: USER_STATUS.DELETED,
    deletedAt: new Date(),
    tokenVersion: (user.tokenVersion ?? 0) + 1,
  });
  await user.save();

  // The photo is a picture of the person, so erasing it is the point of this
  // whole function rather than housekeeping after it. Best-effort all the
  // same: a store that is briefly unreachable must not block somebody from
  // deleting their account, and the record no longer points at the file.
  await discardAvatarObject(photoKey);

  // Remove the things that only exist for this account's own benefit.
  await Promise.all([
    Favourite.deleteMany({ userId }),
    TutorRequest.updateMany({ ownerId: userId }, { $set: { status: "CLOSED", closedAt: new Date() } }),
    StudentProfile.updateMany({ ownerId: userId }, { $set: { archivedAt: new Date() } }),
    TutorProfile.updateOne({ userId }, { $set: { isSearchable: false, status: "SUSPENDED" } }),
    Conversation.updateMany({ participantIds: userId }, { $addToSet: { archivedBy: userId } }),
  ]);

  await recordAudit({
    actor: { id: userId, role: user.role },
    action: AUDIT_ACTIONS.USER_DELETED,
    entityType: "User",
    entityId: userId,
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

export async function getUserDetail(id) {
  const user = await User.findById(id).lean();
  if (!user) throw new NotFoundError("We couldn't find that account.");

  const [tutorProfile, students, bookingCount, spend] = await Promise.all([
    TutorProfile.findOne({ userId: id }).lean(),
    StudentProfile.find({ ownerId: id }).lean(),
    Booking.countDocuments({
      $or: [{ purchaserId: id }, { tutorUserId: id }],
    }),
    Booking.aggregate([
      { $match: { purchaserId: user._id, status: BOOKING_STATUS.COMPLETED } },
      { $group: { _id: null, total: { $sum: "$price.totalCents" } } },
    ]),
  ]);

  return {
    user: toPlain({ ...user, passwordHash: undefined }),
    tutorProfile: tutorProfile ? toPlain(tutorProfile) : null,
    students: toPlain(students),
    bookingCount,
    lifetimeSpendCents: spend[0]?.total ?? 0,
  };
}

export async function adminUserAction(id, { action, reason }, admin, request) {
  const user = await User.findById(id);
  if (!user) throw new NotFoundError("We couldn't find that account.");

  if (String(user._id) === String(admin.id) && ["SUSPEND", "DELETE"].includes(action)) {
    throw new BusinessRuleError("You cannot suspend or delete your own account.");
  }

  switch (action) {
    case "SUSPEND":
      user.status = USER_STATUS.SUSPENDED;
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      // A suspended tutor disappears from search immediately (§42).
      await TutorProfile.updateOne({ userId: id }, { $set: { isSearchable: false } });
      break;

    case "REINSTATE":
      user.status = user.emailVerifiedAt ? USER_STATUS.ACTIVE : USER_STATUS.PENDING_VERIFICATION;
      break;

    case "VERIFY_EMAIL":
      user.emailVerifiedAt = new Date();
      if (user.status === USER_STATUS.PENDING_VERIFICATION) user.status = USER_STATUS.ACTIVE;
      break;

    case "FORCE_LOGOUT":
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      break;

    case "DELETE":
      user.status = USER_STATUS.DELETED;
      user.deletedAt = new Date();
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await TutorProfile.updateOne({ userId: id }, { $set: { isSearchable: false } });
      break;

    default:
      throw new BusinessRuleError("That action is not supported.");
  }

  await user.save();

  await recordAudit({
    actor: admin,
    action:
      action === "SUSPEND"
        ? AUDIT_ACTIONS.USER_SUSPENDED
        : action === "DELETE"
          ? AUDIT_ACTIONS.USER_DELETED
          : AUDIT_ACTIONS.USER_REINSTATED,
    entityType: "User",
    entityId: user._id,
    metadata: { action, reason },
    request,
  });

  return toPlain({ ...user.toObject(), passwordHash: undefined });
}

export { revokeAllSessions };
