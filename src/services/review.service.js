import "server-only";
import { Types } from "mongoose";
import { Review, Booking, TutorProfile, User } from "@/models";
import {
  REVIEW_STATUS,
  REPORT_STATUS,
  ACTIVE_REPORT_STATUSES,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
  USER_STATUS,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { requireVerifiedEmail } from "@/lib/auth/assert";
import { toPlain } from "@/lib/utils/serialize";
import { publicName } from "@/lib/utils/format";
import { sanitizeMultiline } from "@/lib/security/sanitize";
import { canReview } from "@/lib/booking/policy";
import { refreshTutorStats } from "./tutor.service";
import { getSettings } from "./settings.service";
import { notify, notifyMany } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Reviews (§23).
 *
 * A review is only ever created from a COMPLETED booking the author paid for,
 * which is what makes every review on the platform a verified one (§42).
 */

export async function createReview(input, actor) {
  requireVerifiedEmail(actor, "Confirm your email address before leaving a review.");

  const booking = await Booking.findById(input.bookingId);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  if (String(booking.purchaserId) !== String(actor.id)) {
    throw new AuthorizationError("You can only review lessons you booked.");
  }
  if (booking.status !== BOOKING_STATUS.COMPLETED) {
    throw new BusinessRuleError(
      "You can leave a review once the lesson is complete.",
      "BOOKING_NOT_COMPLETED",
    );
  }
  if (!canReview(booking)) {
    throw new ConflictError("You have already reviewed this lesson.");
  }

  const settings = await getSettings();
  // The written part is optional (R21.2). Absent stays absent — never an
  // empty string — so "has this review got words?" is one `$exists` away.
  const body = input.body ? sanitizeMultiline(input.body, { maxLength: 2000 }) || undefined : undefined;

  const review = await Review.create({
    bookingId: booking._id,
    tutorProfileId: booking.tutorProfileId,
    tutorUserId: booking.tutorUserId,
    authorId: actor.id,
    studentProfileId: booking.studentProfileId,
    courseId: booking.courseId,
    courseCode: booking.courseCode,
    courseName: booking.courseName,
    rating: input.rating,
    knowledge: input.knowledge,
    communication: input.communication,
    reliability: input.reliability,
    teaching: input.teaching,
    title: input.title,
    body,
    isVerified: true,
    status: settings.autoModerateReviews
      ? REVIEW_STATUS.PENDING_MODERATION
      : REVIEW_STATUS.PUBLISHED,
  });

  booking.reviewId = review._id;
  await booking.save();

  await refreshTutorStats(booking.tutorProfileId);

  const author = await User.findById(actor.id).select("firstName lastName").lean();
  await notify({
    userId: booking.tutorUserId,
    type: NOTIFICATION_TYPES.REVIEW_RECEIVED,
    title: `${publicName(author?.firstName ?? "", author?.lastName ?? "")} left you a ${input.rating}-star review`,
    body: input.title ?? body?.slice(0, 140),
    href: "/tutor/reviews",
    entityType: "Review",
    entityId: review._id,
  });

  return toPlain(review);
}

export async function listReviews(
  actor,
  { page = 1, pageSize, status, reported, tutorProfileId } = {},
) {
  const size = pageSize ?? PAGE_SIZES.reviews;
  const query = {};

  if (actor.role === ROLES.TUTOR) {
    query.tutorUserId = actor.id;
    query.status = { $ne: REVIEW_STATUS.REMOVED };
  } else if (actor.role === ROLES.ADMIN) {
    if (status) query.status = status;
    // The moderation queue is driven by the report case, not by visibility:
    // a reported review is still published until somebody rules on it.
    if (reported) query.reportStatus = { $in: ACTIVE_REPORT_STATUSES };
    if (tutorProfileId) query.tutorProfileId = tutorProfileId;
  } else {
    query.authorId = actor.id;
  }

  const [items, total] = await Promise.all([
    Review.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("authorId", "firstName lastName")
      .populate("bookingId", "reference startAt courseName")
      .populate({
        path: "tutorProfileId",
        select: "slug userId",
        populate: { path: "userId", select: "firstName lastName avatarUrl" },
      })
      .lean(),
    Review.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

export async function replyToReview(reviewId, { reply }, actor) {
  const review = await Review.findById(reviewId);
  if (!review) throw new NotFoundError("That review no longer exists.");

  if (String(review.tutorUserId) !== String(actor.id)) {
    throw new AuthorizationError("Only the reviewed tutor can reply.");
  }
  if (review.tutorReply) {
    throw new ConflictError("You have already replied to this review.");
  }

  review.tutorReply = sanitizeMultiline(reply, { maxLength: 1200 });
  review.tutorRepliedAt = new Date();
  await review.save();

  await notify({
    userId: review.authorId,
    type: NOTIFICATION_TYPES.REVIEW_RECEIVED,
    title: "Your tutor replied to your review",
    body: review.tutorReply.slice(0, 140),
    href: "/reviews",
    entityType: "Review",
    entityId: review._id,
  });

  return toPlain(review);
}

/**
 * Report a review for moderation (§23, R21.5).
 *
 * Any signed-in member may report a review the public can see; the two
 * parties to it — the reviewed tutor and the author — and an administrator
 * may also report one that is not public yet. Several members may report the
 * same review while its case is open, and each is recorded; the same member
 * is refused a second report until a moderator has ruled.
 *
 * Reporting opens a case; it does not decide one. The review stays visible
 * and keeps counting towards the tutor's average until a moderator rules on
 * it — otherwise the subject of an unfavourable review could delete it from
 * the public rating simply by objecting to it, which is the opposite of what
 * moderation is for. Only an administrator changes what the public sees.
 */
export async function reportReview(reviewId, { reason }, actor) {
  const review = await Review.findById(reviewId)
    .select("status tutorUserId authorId tutorProfileId reportStatus reportedAt")
    .lean();
  if (!review) throw new NotFoundError("That review no longer exists.");

  const isAdmin = actor.role === ROLES.ADMIN;
  const isTutor = String(review.tutorUserId) === String(actor.id);
  const isAuthor = String(review.authorId) === String(actor.id);
  const isParty = isAdmin || isTutor || isAuthor;

  // A member who is neither party can only see — and so only report — a
  // published review. Anything else reads as not there, rather than as a
  // refusal that confirms it exists.
  if (review.status === REVIEW_STATUS.REMOVED && !isAdmin) {
    throw new NotFoundError("That review no longer exists.");
  }
  if (!isParty && review.status !== REVIEW_STATUS.PUBLISHED) {
    throw new NotFoundError("That review no longer exists.");
  }

  const reporterRole = isAdmin ? "ADMIN" : isTutor ? "TUTOR" : isAuthor ? "AUTHOR" : "MEMBER";
  const now = new Date();
  const entry = { at: now, byId: actor.id, byRole: reporterRole, action: REPORT_STATUS.OPEN, note: reason };

  // An administrator reporting a review *is* a moderator acting, so they may
  // take it out of the public average immediately. Nobody else can.
  const hide = isAdmin ? { status: REVIEW_STATUS.REPORTED } : {};

  // Open a case if none is active. Conditional, so two first reports cannot
  // both believe they opened it.
  let updated = await Review.findOneAndUpdate(
    { _id: review._id, reportStatus: { $nin: ACTIVE_REPORT_STATUSES } },
    {
      $set: {
        reportStatus: REPORT_STATUS.OPEN,
        reportedAt: now,
        reportedBy: actor.id,
        reportedByRole: reporterRole,
        reportReason: reason,
        ...hide,
      },
      $push: { reportHistory: entry },
    },
    { returnDocument: "after" },
  ).lean();
  const opened = Boolean(updated);

  if (!updated) {
    // A case is already open: join it, unless this member is already in it.
    const current = await Review.findById(review._id).select("reportedAt").lean();
    updated = await Review.findOneAndUpdate(
      {
        _id: review._id,
        reportStatus: { $in: ACTIVE_REPORT_STATUSES },
        reportHistory: {
          $not: {
            $elemMatch: {
              byId: new Types.ObjectId(String(actor.id)),
              action: REPORT_STATUS.OPEN,
              at: { $gte: current?.reportedAt ?? new Date(0) },
            },
          },
        },
      },
      { $push: { reportHistory: entry }, ...(isAdmin ? { $set: hide } : {}) },
      { returnDocument: "after" },
    ).lean();
    if (!updated) {
      throw new ConflictError("You have already reported this review. Our moderation team has it.");
    }
  }

  if (isAdmin) await refreshTutorStats(review.tutorProfileId);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REVIEW_REPORTED,
    entityType: "Review",
    entityId: review._id,
    metadata: { reporterRole, opened, reason },
  });

  if (opened) {
    await notifyActiveAdmins({
      type: NOTIFICATION_TYPES.CONTENT_REPORTED,
      title: "A review was reported",
      body: reason.slice(0, 200),
      href: "/admin/reviews?status=reported",
      entityType: "Review",
      entityId: review._id,
    });
  }

  return {
    reported: true,
    reportStatus: updated.reportStatus,
    /** The review stays public while the case is open — say so plainly. */
    stillVisible: updated.status !== REVIEW_STATUS.REPORTED,
  };
}

/**
 * A moderator's ruling — the only thing that changes a review's visibility.
 *
 * PUBLISHED approves a review awaiting approval, dismisses a report, or
 * reinstates a removed review; REMOVED upholds a report or takes a review
 * down. A ruling that would change nothing — publishing a published review
 * nobody reported — is refused, so the audit trail only records decisions.
 */
export async function moderateReview(reviewId, { status, note }, admin) {
  const review = await Review.findById(reviewId);
  if (!review) throw new NotFoundError("That review no longer exists.");

  const from = review.status;
  const caseOpen = ACTIVE_REPORT_STATUSES.includes(review.reportStatus);
  if (from === status && !caseOpen) {
    throw new ConflictError(
      status === REVIEW_STATUS.REMOVED
        ? "That review has already been removed."
        : "That review is already published.",
    );
  }

  review.status = status;
  review.moderatedAt = new Date();
  review.moderatedBy = admin.id;
  review.moderationNote = note;

  // Removing upholds the report; keeping it published dismisses it.
  if (caseOpen) {
    review.reportStatus =
      status === REVIEW_STATUS.REMOVED ? REPORT_STATUS.RESOLVED : REPORT_STATUS.DISMISSED;
    review.reportHistory.push({
      at: new Date(),
      byId: admin.id,
      byRole: "ADMIN",
      action: review.reportStatus,
      note,
    });
  }

  await review.save();

  // Approving a pending review is what first puts it in the average.
  await refreshTutorStats(review.tutorProfileId);

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.REVIEW_MODERATED,
    entityType: "Review",
    entityId: review._id,
    metadata: {
      from,
      status,
      approved: from === REVIEW_STATUS.PENDING_MODERATION && status === REVIEW_STATUS.PUBLISHED,
      reportStatus: review.reportStatus,
      note,
    },
  });

  return toPlain(review);
}

/** In-app notice to every active administrator. Never breaks its caller. */
async function notifyActiveAdmins(payload) {
  try {
    const admins = await User.find({
      role: ROLES.ADMIN,
      status: USER_STATUS.ACTIVE,
      deletedAt: null,
    })
      .select("_id")
      .lean();
    await notifyMany(admins.map((a) => a._id), payload);
  } catch (error) {
    console.error("[review] could not notify administrators of a report", error);
  }
}

/** Rating distribution for a tutor's public profile. */
export async function ratingBreakdown(tutorProfileId) {
  const rows = await Review.aggregate([
    {
      $match: {
        tutorProfileId:
          typeof tutorProfileId === "string" ? new Types.ObjectId(tutorProfileId) : tutorProfileId,
        status: REVIEW_STATUS.PUBLISHED,
      },
    },
    { $group: { _id: "$rating", count: { $sum: 1 } } },
  ]);

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const row of rows) {
    counts[row._id] = row.count;
    total += row.count;
  }

  return {
    counts,
    total,
    percentages: Object.fromEntries(
      Object.entries(counts).map(([star, count]) => [
        star,
        total ? Math.round((count / total) * 100) : 0,
      ]),
    ),
  };
}
