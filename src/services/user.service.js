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
import { USER_STATUS, ROLES, BOOKING_STATUS, AUDIT_ACTIONS, PAGE_SIZES } from "@/constants";
import { NotFoundError, BusinessRuleError, AuthenticationError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { verifyPassword } from "@/lib/auth/password";
import { escapeRegex } from "@/lib/security/sanitize";
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

  Object.assign(user, {
    email: anonymousEmail,
    firstName: "Deleted",
    lastName: "Account",
    phone: undefined,
    avatarUrl: undefined,
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
