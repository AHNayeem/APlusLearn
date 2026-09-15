import "server-only";
import { Types } from "mongoose";
import { Review, Booking, TutorProfile, User } from "@/models";
import {
  REVIEW_STATUS,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicName } from "@/lib/utils/format";
import { sanitizeMultiline } from "@/lib/security/sanitize";
import { canReview } from "@/lib/booking/policy";
import { refreshTutorStats } from "./tutor.service";
import { getSettings } from "./settings.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Reviews (§23).
 *
 * A review is only ever created from a COMPLETED booking the author paid for,
 * which is what makes every review on the platform a verified one (§42).
 */

export async function createReview(input, actor) {
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
  const body = sanitizeMultiline(input.body, { maxLength: 2000 });

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
    body: input.title ?? body.slice(0, 140),
    href: "/tutor/reviews",
    entityType: "Review",
    entityId: review._id,
  });

  return toPlain(review);
}

export async function listReviews(actor, { page = 1, pageSize, status, tutorProfileId } = {}) {
  const size = pageSize ?? PAGE_SIZES.reviews;
  const query = {};

  if (actor.role === ROLES.TUTOR) {
    query.tutorUserId = actor.id;
    query.status = { $ne: REVIEW_STATUS.REMOVED };
  } else if (actor.role === ROLES.ADMIN) {
    if (status) query.status = status;
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

export async function reportReview(reviewId, { reason }, actor) {
  const review = await Review.findById(reviewId);
  if (!review) throw new NotFoundError("That review no longer exists.");

  // Either party to the review, or an admin, may report it.
  const allowed =
    actor.role === ROLES.ADMIN ||
    String(review.tutorUserId) === String(actor.id) ||
    String(review.authorId) === String(actor.id);
  if (!allowed) throw new AuthorizationError("You cannot report this review.");

  review.status = REVIEW_STATUS.REPORTED;
  review.reportedAt = new Date();
  review.reportedBy = actor.id;
  review.reportReason = reason;
  await review.save();

  // Reported reviews leave the public average until moderated.
  await refreshTutorStats(review.tutorProfileId);

  return { reported: true };
}

export async function moderateReview(reviewId, { status, note }, admin) {
  const review = await Review.findById(reviewId);
  if (!review) throw new NotFoundError("That review no longer exists.");

  review.status = status;
  review.moderatedAt = new Date();
  review.moderatedBy = admin.id;
  review.moderationNote = note;
  await review.save();

  await refreshTutorStats(review.tutorProfileId);

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.REVIEW_MODERATED,
    entityType: "Review",
    entityId: review._id,
    metadata: { status, note },
  });

  return toPlain(review);
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
