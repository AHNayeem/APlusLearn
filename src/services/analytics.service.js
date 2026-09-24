import "server-only";
import { Types } from "mongoose";
import {
  User,
  TutorProfile,
  TutorApplication,
  Booking,
  Payment,
  Review,
  Dispute,
  Conversation,
  StudentProfile,
  VerificationRecord,
  TutorRequest,
  TutorMatch,
  TutorPackage,
  PackagePurchase,
  GroupSession,
  GroupEnrolment,
  Referral,
  CreditEntry,
  ProgressReport,
  TutorPromotion,
  RiskCase,
} from "@/models";
import {
  ROLES,
  TUTOR_STATUS,
  BOOKING_STATUS,
  PAYMENT_STATUS,
  OPEN_DISPUTE_STATUSES,
  LESSON_MODES,
  CANCELLED_STATUSES,
  ACTIVE_REPORT_STATUSES,
  REQUEST_STATUS,
  MATCH_STATUS,
  PACKAGE_STATUS,
  PACKAGE_PURCHASE_STATUS,
  GROUP_SESSION_STATUS,
  PROMOTION_STATUS,
  REFERRAL_STATUS,
  OPEN_RISK_CASE_STATUSES,
  PROGRESS_REPORT_STATUS,
  CREDIT_REASONS,
} from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { learnerDisplayName } from "@/lib/utils/format";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import {
  resolveRange,
  dateWindow,
  bucketExpression,
  percentChange,
  rate,
} from "@/lib/analytics/range";
import { livePromotionQuery } from "@/lib/search/promotion";

/**
 * Marketplace analytics (§25, §41 Phase 2).
 *
 * Three rules hold every figure on this page together. They are worth stating
 * because each one is a mistake this file used to make, or could easily make:
 *
 *   **Money comes from payments, not from bookings.** A booking records what
 *   a lesson *would* cost; a payment records what was actually taken. Summing
 *   booking prices counts abandoned checkouts and cancelled lessons as
 *   revenue, which overstates the marketplace by however much of it never
 *   happened. Every money figure below is aggregated from `Payment`, on
 *   `paidAt`, over payments that actually settled.
 *
 *   **Refunds are subtracted, pro rata.** The platform's cancellation policy
 *   refunds a *percentage of the whole*, so a refund takes the same share of
 *   the commission as it does of the tutor's earnings. Net platform revenue
 *   therefore subtracts each payment's own refunded share of its own
 *   commission — computed per payment inside the pipeline, never from a ratio
 *   of two aggregates, which would be a different and wrong number.
 *
 *   **Aggregation happens in MongoDB.** Nothing here reads a collection into
 *   an array and reduces it. A figure computed from a page of results is a
 *   figure that silently becomes wrong the moment the marketplace outgrows
 *   the page size.
 *
 * Periods are half-open and time-zone aware — see `lib/analytics/range.js`.
 */

/** Payments that represent money genuinely taken at some point. */
const SETTLED_PAYMENT_STATUSES = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
  PAYMENT_STATUS.REFUNDED,
];

const NO_SHOW_STATUSES = [BOOKING_STATUS.NO_SHOW_STUDENT, BOOKING_STATUS.NO_SHOW_TUTOR];

/**
 * The money figures for one window, straight out of `Payment`.
 *
 * `$match` is on `paidAt` rather than `createdAt`: a checkout begun on the
 * 31st and completed on the 1st is revenue for the month it was paid in, not
 * the month the browser was opened in.
 */
async function revenueAggregate(window, extraMatch = {}) {
  const [row] = await Payment.aggregate([
    {
      $match: {
        status: { $in: SETTLED_PAYMENT_STATUSES },
        ...dateWindow("paidAt", window),
        ...extraMatch,
      },
    },
    {
      $group: {
        _id: null,
        payments: { $sum: 1 },
        /** Lesson value, before any credit was applied to the card. */
        grossCents: { $sum: "$subtotalCents" },
        /** What cards were actually charged. */
        collectedCents: { $sum: "$totalCents" },
        commissionCents: { $sum: "$commissionCents" },
        tutorEarningsCents: { $sum: "$tutorEarningsCents" },
        refundedCents: { $sum: { $ifNull: ["$refundedCents", 0] } },
        /**
         * Credit is funded by the platform's commission, not by the tutor, so
         * it is a cost against platform revenue rather than a discount on the
         * lesson (§41 Phase 2).
         */
        creditAppliedCents: { $sum: { $ifNull: ["$creditAppliedCents", 0] } },
        /** Each payment's own refunded share of its own commission. */
        refundedCommissionCents: {
          $sum: {
            $cond: [
              { $gt: ["$totalCents", 0] },
              {
                $round: [
                  {
                    $multiply: [
                      "$commissionCents",
                      { $divide: [{ $ifNull: ["$refundedCents", 0] }, "$totalCents"] },
                    ],
                  },
                  0,
                ],
              },
              0,
            ],
          },
        },
      },
    },
  ]);

  const base = row ?? {
    payments: 0,
    grossCents: 0,
    collectedCents: 0,
    commissionCents: 0,
    tutorEarningsCents: 0,
    refundedCents: 0,
    creditAppliedCents: 0,
    refundedCommissionCents: 0,
  };

  return {
    ...base,
    netCollectedCents: base.collectedCents - base.refundedCents,
    platformRevenueCents:
      base.commissionCents - base.refundedCommissionCents - base.creditAppliedCents,
  };
}

/**
 * Lesson counts for one window, by what actually became of each lesson.
 *
 * Matched on `startAt`: "how many lessons ran in March" is a question about
 * when they were taught. A booking that was never paid for is excluded from
 * every rate, because an abandoned checkout is not a cancellation and
 * counting it as one makes tutors look unreliable.
 */
async function lessonAggregate(window, extraMatch = {}) {
  const [row] = await Booking.aggregate([
    {
      $match: {
        status: {
          $nin: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED],
        },
        ...dateWindow("startAt", window),
        ...extraMatch,
      },
    },
    {
      $group: {
        _id: null,
        lessons: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $in: ["$status", CANCELLED_STATUSES] }, 1, 0] } },
        cancelledByStudent: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.CANCELLED_BY_STUDENT] }, 1, 0] },
        },
        cancelledByTutor: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.CANCELLED_BY_TUTOR] }, 1, 0] },
        },
        noShows: { $sum: { $cond: [{ $in: ["$status", NO_SHOW_STATUSES] }, 1, 0] } },
        studentNoShows: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.NO_SHOW_STUDENT] }, 1, 0] },
        },
        tutorNoShows: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.NO_SHOW_TUTOR] }, 1, 0] },
        },
        disputed: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.DISPUTED] }, 1, 0] } },
        /** A group seat and a package draw are lessons too, counted apart. */
        fromPackage: { $sum: { $cond: [{ $ifNull: ["$packagePurchaseId", false] }, 1, 0] } },
        inGroup: { $sum: { $cond: [{ $ifNull: ["$groupSessionId", false] }, 1, 0] } },
        teachingMinutes: {
          $sum: {
            $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, "$durationMinutes", 0],
          },
        },
      },
    },
  ]);

  const base = row ?? {
    lessons: 0, completed: 0, cancelled: 0, cancelledByStudent: 0, cancelledByTutor: 0,
    noShows: 0, studentNoShows: 0, tutorNoShows: 0, disputed: 0,
    fromPackage: 0, inGroup: 0, teachingMinutes: 0,
  };

  return {
    ...base,
    completionRate: rate(base.completed, base.lessons),
    cancellationRate: rate(base.cancelled, base.lessons),
    noShowRate: rate(base.noShows, base.lessons),
  };
}

/**
 * The headline marketplace figures (§25).
 *
 * @param {object} [options] A reporting period — `days`, or `from`/`to`, plus
 *                           an optional `timeZone`. See `resolveRange`.
 */
export async function marketplaceOverview(options = {}) {
  const range = resolveRange(options);

  const [
    registeredTutors,
    approvedTutors,
    pendingApplications,
    activeStudentIds,
    totalLearners,
    revenue,
    previousRevenue,
    lessons,
    previousLessons,
    newRegistrations,
    previousRegistrations,
    openDisputes,
    pendingReviews,
    promotedNow,
  ] = await Promise.all([
    User.countDocuments({ role: ROLES.TUTOR, deletedAt: null }),
    TutorProfile.countDocuments({ status: TUTOR_STATUS.APPROVED, isSearchable: true }),
    TutorApplication.countDocuments({ status: TUTOR_STATUS.PENDING_REVIEW }),
    // "Active" means they actually booked inside the window.
    Booking.distinct("purchaserId", dateWindow("createdAt", range)),
    StudentProfile.countDocuments({ archivedAt: null }),
    revenueAggregate(range),
    revenueAggregate(range.previous),
    lessonAggregate(range),
    lessonAggregate(range.previous),
    User.countDocuments({ ...dateWindow("createdAt", range), deletedAt: null }),
    User.countDocuments({ ...dateWindow("createdAt", range.previous), deletedAt: null }),
    Dispute.countDocuments({
      status: { $in: OPEN_DISPUTE_STATUSES },
    }),
    Review.countDocuments({ reportStatus: { $in: ACTIVE_REPORT_STATUSES } }),
    TutorPromotion.countDocuments(livePromotionQuery()),
  ]);

  return {
    period: describe(range),
    supply: {
      registeredTutors,
      approvedTutors,
      pendingApplications,
      approvalRate: rate(approvedTutors, registeredTutors),
      promotedNow,
    },
    demand: {
      activeStudents: activeStudentIds.length,
      totalLearners,
      newRegistrations,
      registrationChange: percentChange(newRegistrations, previousRegistrations),
    },
    commerce: {
      /** Lessons taught in the window, whatever became of them. */
      bookings: lessons.lessons,
      bookingChange: percentChange(lessons.lessons, previousLessons.lessons),
      grossSalesCents: revenue.grossCents,
      grossChange: percentChange(revenue.grossCents, previousRevenue.grossCents),
      collectedCents: revenue.collectedCents,
      refundedCents: revenue.refundedCents,
      netCollectedCents: revenue.netCollectedCents,
      /** Commission, less refunded commission, less platform-funded credit. */
      platformRevenueCents: revenue.platformRevenueCents,
      platformRevenueChange: percentChange(
        revenue.platformRevenueCents,
        previousRevenue.platformRevenueCents,
      ),
      referralCreditCents: revenue.creditAppliedCents,
      tutorEarningsCents: revenue.tutorEarningsCents,
      payments: revenue.payments,
      averageBookingValueCents: revenue.payments
        ? Math.round(revenue.grossCents / revenue.payments)
        : 0,
      completedLessons: lessons.completed,
      completionRate: lessons.completionRate,
      cancellationRate: lessons.cancellationRate,
      noShowRate: lessons.noShowRate,
      teachingHours: Math.round(lessons.teachingMinutes / 60),
    },
    reliability: {
      cancelledByStudent: lessons.cancelledByStudent,
      cancelledByTutor: lessons.cancelledByTutor,
      studentNoShows: lessons.studentNoShows,
      tutorNoShows: lessons.tutorNoShows,
      disputed: lessons.disputed,
      disputeRate: rate(lessons.disputed, lessons.lessons),
    },
    health: { openDisputes, pendingReviews },
  };
}

/** Which subjects, courses and cities the marketplace actually runs on. */
export async function marketplaceBreakdowns(options = {}) {
  const range = resolveRange(options);
  const limit = Math.min(options.limit ?? 8, 50);
  const lessonMatch = {
    status: { $nin: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED] },
    ...dateWindow("startAt", range),
  };

  const [subjects, courses, cities, modes, series] = await Promise.all([
    Booking.aggregate([
      { $match: lessonMatch },
      {
        $group: {
          _id: "$subjectName",
          bookings: { $sum: 1 },
          revenueCents: { $sum: "$price.subtotalCents" },
        },
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { bookings: -1, _id: 1 } },
      { $limit: limit },
    ]),
    Booking.aggregate([
      { $match: lessonMatch },
      {
        $group: {
          _id: { code: "$courseCode", name: "$courseName" },
          bookings: { $sum: 1 },
          revenueCents: { $sum: "$price.subtotalCents" },
        },
      },
      { $sort: { bookings: -1, "_id.name": 1 } },
      { $limit: limit },
    ]),
    TutorProfile.aggregate([
      { $match: { isSearchable: true } },
      { $group: { _id: "$city", tutors: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { tutors: -1, _id: 1 } },
      { $limit: limit },
    ]),
    Booking.aggregate([
      { $match: lessonMatch },
      { $group: { _id: "$mode", count: { $sum: 1 } } },
    ]),
    // The time series. Bucketed in the reporting zone, so a Toronto evening
    // lesson lands on the Toronto day it was taught.
    Booking.aggregate([
      { $match: lessonMatch },
      {
        $group: {
          _id: bucketExpression("startAt", range),
          bookings: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] },
          },
          cancelled: { $sum: { $cond: [{ $in: ["$status", CANCELLED_STATUSES] }, 1, 0] } },
          revenueCents: { $sum: "$price.subtotalCents" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const modeMap = Object.fromEntries(modes.map((m) => [m._id, m.count]));

  return {
    period: describe(range),
    popularSubjects: subjects.map((s) => ({
      name: s._id,
      bookings: s.bookings,
      revenueCents: s.revenueCents,
    })),
    popularCourses: courses.map((c) => ({
      code: c._id.code,
      name: c._id.name,
      bookings: c.bookings,
      revenueCents: c.revenueCents,
    })),
    activeCities: cities.map((c) => ({ city: c._id, tutors: c.tutors })),
    lessonModes: {
      online: modeMap[LESSON_MODES.ONLINE] ?? 0,
      inPerson: modeMap[LESSON_MODES.IN_PERSON] ?? 0,
    },
    granularity: range.granularity,
    /** Kept under its old name so existing readers do not break. */
    dailyBookings: series.map((d) => ({
      date: d._id,
      bookings: d.bookings,
      completed: d.completed,
      cancelled: d.cancelled,
      revenueCents: d.revenueCents,
    })),
  };
}

/**
 * How the Phase 2 features are actually performing (§41 Phase 2).
 *
 * Each block answers one operational question an administrator would
 * otherwise have to ask the database directly: are requests turning into
 * lessons, are packages being used up or expiring unused, are group sessions
 * filling, is the referral scheme buying anything, and are promotions worth
 * running.
 */
export async function phaseTwoAnalytics(options = {}) {
  const range = resolveRange(options);
  const window = dateWindow("createdAt", range);

  const [
    requests,
    matches,
    packages,
    packageBalances,
    groups,
    groupSeats,
    referrals,
    creditSpent,
    progress,
    promotions,
  ] = await Promise.all([
    TutorRequest.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          created: { $sum: 1 },
          matched: { $sum: { $cond: [{ $eq: ["$status", REQUEST_STATUS.MATCHED] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ["$status", REQUEST_STATUS.EXPIRED] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", REQUEST_STATUS.CANCELLED] }, 1, 0] } },
          open: { $sum: { $cond: [{ $eq: ["$status", REQUEST_STATUS.OPEN] }, 1, 0] } },
          suggestions: { $sum: { $ifNull: ["$suggestedCount", 0] } },
        },
      },
    ]),
    TutorMatch.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          suggested: { $sum: 1 },
          /** The tutor put their hand up. */
          interested: {
            $sum: { $cond: [{ $eq: ["$status", MATCH_STATUS.TUTOR_INTERESTED] }, 1, 0] },
          },
          /** The family booked them — the only outcome that is worth money. */
          booked: { $sum: { $cond: [{ $eq: ["$status", MATCH_STATUS.BOOKED] }, 1, 0] } },
          declined: {
            $sum: {
              $cond: [
                { $in: ["$status", [MATCH_STATUS.TUTOR_DECLINED, MATCH_STATUS.DECLINED]] },
                1,
                0,
              ],
            },
          },
          averageScore: { $avg: "$score" },
        },
      },
    ]),
    TutorPackage.countDocuments({ status: PACKAGE_STATUS.ACTIVE }),
    PackagePurchase.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          purchases: { $sum: 1 },
          sessionsSold: { $sum: "$sessionsTotal" },
          sessionsUsed: { $sum: "$sessionsUsed" },
          grossCents: { $sum: "$priceCents" },
          refundedCents: { $sum: { $ifNull: ["$refundedCents", 0] } },
          expired: {
            $sum: { $cond: [{ $eq: ["$status", PACKAGE_PURCHASE_STATUS.EXPIRED] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", PACKAGE_PURCHASE_STATUS.COMPLETED] }, 1, 0] },
          },
        },
      },
    ]),
    GroupSession.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          sessions: { $sum: 1 },
          confirmed: {
            $sum: { $cond: [{ $eq: ["$status", GROUP_SESSION_STATUS.CONFIRMED] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$status", GROUP_SESSION_STATUS.COMPLETED] }, 1, 0] },
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ["$status", GROUP_SESSION_STATUS.CANCELLED] }, 1, 0] },
          },
          seatsOffered: { $sum: "$maxParticipants" },
          seatsTaken: { $sum: { $ifNull: ["$seatsTaken", 0] } },
        },
      },
    ]),
    GroupEnrolment.countDocuments(window),
    Referral.aggregate([
      { $match: window },
      {
        $group: {
          _id: null,
          signups: { $sum: 1 },
          qualified: {
            $sum: {
              $cond: [
                { $in: ["$status", [REFERRAL_STATUS.QUALIFIED, REFERRAL_STATUS.REWARDED]] },
                1,
                0,
              ],
            },
          },
          rewarded: { $sum: { $cond: [{ $eq: ["$status", REFERRAL_STATUS.REWARDED] }, 1, 0] } },
          reversed: { $sum: { $cond: [{ $eq: ["$status", REFERRAL_STATUS.REVERSED] }, 1, 0] } },
          flagged: {
            $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$riskFlags", []] } }, 0] }, 1, 0] },
          },
        },
      },
    ]),
    // Credit *granted*, from the ledger. Never counted as revenue: it is
    // marketing spend the platform funds out of its own commission.
    CreditEntry.aggregate([
      {
        $match: {
          ...window,
          reason: { $in: [CREDIT_REASONS.REFERRAL_REWARD, CREDIT_REASONS.REFERRAL_WELCOME] },
        },
      },
      { $group: { _id: null, grantedCents: { $sum: "$amountCents" } } },
    ]),
    ProgressReport.countDocuments({
      ...window,
      status: { $ne: PROGRESS_REPORT_STATUS.DRAFT },
    }),
    TutorPromotion.aggregate([
      { $match: { $or: [window, { status: PROMOTION_STATUS.ACTIVE }] } },
      {
        $group: {
          _id: null,
          created: { $sum: 1 },
          running: {
            $sum: { $cond: [{ $eq: ["$status", PROMOTION_STATUS.ACTIVE] }, 1, 0] },
          },
          finished: {
            $sum: { $cond: [{ $eq: ["$status", PROMOTION_STATUS.EXPIRED] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const req = requests[0] ?? { created: 0, matched: 0, expired: 0, cancelled: 0, open: 0, suggestions: 0 };
  const mat = matches[0] ?? {
    suggested: 0, interested: 0, booked: 0, declined: 0, averageScore: 0,
  };
  const pkg = packageBalances[0] ?? {
    purchases: 0, sessionsSold: 0, sessionsUsed: 0, grossCents: 0,
    refundedCents: 0, expired: 0, completed: 0,
  };
  const grp = groups[0] ?? {
    sessions: 0, confirmed: 0, completed: 0, cancelled: 0, seatsOffered: 0, seatsTaken: 0,
  };
  const ref = referrals[0] ?? { signups: 0, qualified: 0, rewarded: 0, reversed: 0, flagged: 0 };
  const prm = promotions[0] ?? { created: 0, running: 0, finished: 0 };

  return {
    period: describe(range),
    requests: {
      created: req.created,
      matched: req.matched,
      open: req.open,
      expired: req.expired,
      cancelled: req.cancelled,
      /** The one number that says whether requests are worth running. */
      matchRate: rate(req.matched, req.created),
      averageSuggestions: req.created ? Math.round(req.suggestions / req.created) : 0,
    },
    matching: {
      suggested: mat.suggested,
      interested: mat.interested,
      booked: mat.booked,
      declined: mat.declined,
      /** How often a suggested tutor engages at all. */
      responseRate: rate(mat.interested + mat.declined, mat.suggested),
      /** How often a suggestion becomes a lesson. */
      bookingRate: rate(mat.booked, mat.suggested),
      averageScore: Math.round(mat.averageScore ?? 0),
    },
    packages: {
      onSale: packages,
      purchases: pkg.purchases,
      sessionsSold: pkg.sessionsSold,
      sessionsUsed: pkg.sessionsUsed,
      /** Unused lessons are a refund liability, not revenue. */
      utilisationRate: rate(pkg.sessionsUsed, pkg.sessionsSold),
      expiredUnused: pkg.expired,
      completed: pkg.completed,
      grossCents: pkg.grossCents,
      refundedCents: pkg.refundedCents,
    },
    groups: {
      sessions: grp.sessions,
      confirmed: grp.confirmed,
      completed: grp.completed,
      cancelled: grp.cancelled,
      enrolments: groupSeats,
      seatsOffered: grp.seatsOffered,
      seatsTaken: grp.seatsTaken,
      fillRate: rate(grp.seatsTaken, grp.seatsOffered),
      /** Sessions cancelled for being under-subscribed are the failure mode. */
      cancellationRate: rate(grp.cancelled, grp.sessions),
    },
    referrals: {
      signups: ref.signups,
      qualified: ref.qualified,
      rewarded: ref.rewarded,
      reversed: ref.reversed,
      flagged: ref.flagged,
      conversionRate: rate(ref.qualified, ref.signups),
      creditGrantedCents: creditSpent[0]?.grantedCents ?? 0,
    },
    progressReports: { shared: progress },
    promotions: { created: prm.created, running: prm.running, finished: prm.finished },
  };
}

/**
 * The strongest and weakest tutors by the measures that matter to supply
 * management: who is delivering lessons, and who is cancelling them.
 */
export async function tutorLeaderboard(options = {}) {
  const range = resolveRange(options);
  const limit = Math.min(options.limit ?? 10, 50);

  const rows = await Booking.aggregate([
    {
      $match: {
        status: { $nin: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED] },
        ...dateWindow("startAt", range),
      },
    },
    {
      $group: {
        _id: "$tutorUserId",
        lessons: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] } },
        cancelled: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.CANCELLED_BY_TUTOR] }, 1, 0] },
        },
        noShows: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.NO_SHOW_TUTOR] }, 1, 0] },
        },
        earningsCents: {
          $sum: {
            $cond: [
              { $eq: ["$status", BOOKING_STATUS.COMPLETED] },
              "$price.tutorEarningsCents",
              0,
            ],
          },
        },
      },
    },
    { $sort: { completed: -1, earningsCents: -1, _id: 1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "tutor",
        pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
      },
    },
    { $unwind: { path: "$tutor", preserveNullAndEmptyArrays: true } },
  ]);

  return {
    period: describe(range),
    tutors: rows.map((row) => ({
      tutorUserId: String(row._id),
      name: [row.tutor?.firstName, row.tutor?.lastName].filter(Boolean).join(" ") || "Unknown",
      lessons: row.lessons,
      completed: row.completed,
      cancelled: row.cancelled,
      noShows: row.noShows,
      completionRate: rate(row.completed, row.lessons),
      cancellationRate: rate(row.cancelled, row.lessons),
      earningsCents: row.earningsCents,
    })),
  };
}

/**
 * One tutor's own performance (§41 Phase 2, §10).
 *
 * Scoped by `tutorUserId`, which every caller takes from the session and
 * never from a request field — a tutor asking for analytics gets their own
 * and there is no parameter through which they could ask for somebody
 * else's.
 */
export async function tutorAnalytics(tutorUserId, options = {}) {
  const range = resolveRange(options);
  const id = typeof tutorUserId === "string" ? new Types.ObjectId(tutorUserId) : tutorUserId;
  const mine = { tutorUserId: id };

  const [lessons, previousLessons, revenue, series, students, reviews, courses] =
    await Promise.all([
      lessonAggregate(range, mine),
      lessonAggregate(range.previous, mine),
      revenueAggregate(range, mine),
      Booking.aggregate([
        {
          $match: {
            ...mine,
            status: { $nin: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED] },
            ...dateWindow("startAt", range),
          },
        },
        {
          $group: {
            _id: bucketExpression("startAt", range),
            lessons: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] },
            },
            earningsCents: {
              $sum: {
                $cond: [
                  { $eq: ["$status", BOOKING_STATUS.COMPLETED] },
                  "$price.tutorEarningsCents",
                  0,
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      // Repeat business, which is the single best signal of teaching quality
      // the platform can compute without reading a review.
      Booking.aggregate([
        { $match: { ...mine, status: BOOKING_STATUS.COMPLETED, ...dateWindow("startAt", range) } },
        { $group: { _id: "$studentProfileId", lessons: { $sum: 1 } } },
        {
          $group: {
            _id: null,
            students: { $sum: 1 },
            returning: { $sum: { $cond: [{ $gt: ["$lessons", 1] }, 1, 0] } },
          },
        },
      ]),
      Review.aggregate([
        { $match: { tutorUserId: id, ...dateWindow("createdAt", range) } },
        { $group: { _id: null, count: { $sum: 1 }, average: { $avg: "$rating" } } },
      ]),
      Booking.aggregate([
        {
          $match: {
            ...mine,
            status: BOOKING_STATUS.COMPLETED,
            ...dateWindow("startAt", range),
          },
        },
        {
          $group: {
            _id: { code: "$courseCode", name: "$courseName" },
            lessons: { $sum: 1 },
            earningsCents: { $sum: "$price.tutorEarningsCents" },
          },
        },
        { $sort: { lessons: -1, "_id.name": 1 } },
        { $limit: 8 },
      ]),
    ]);

  const student = students[0] ?? { students: 0, returning: 0 };

  return {
    period: describe(range),
    lessons: {
      total: lessons.lessons,
      completed: lessons.completed,
      completedChange: percentChange(lessons.completed, previousLessons.completed),
      cancelled: lessons.cancelled,
      cancelledByMe: lessons.cancelledByTutor,
      noShows: lessons.noShows,
      completionRate: lessons.completionRate,
      cancellationRate: lessons.cancellationRate,
      teachingHours: Math.round(lessons.teachingMinutes / 60),
      fromPackage: lessons.fromPackage,
      inGroup: lessons.inGroup,
    },
    earnings: {
      /** The tutor's share only. Commission and platform credit are not theirs. */
      netCents: revenue.tutorEarningsCents,
      grossCents: revenue.grossCents,
      refundedCents: revenue.refundedCents,
    },
    students: {
      taught: student.students,
      returning: student.returning,
      repeatRate: rate(student.returning, student.students),
    },
    reviews: {
      count: reviews[0]?.count ?? 0,
      average: Math.round((reviews[0]?.average ?? 0) * 10) / 10,
    },
    granularity: range.granularity,
    series: series.map((d) => ({
      date: d._id,
      lessons: d.lessons,
      completed: d.completed,
      earningsCents: d.earningsCents,
    })),
    courses: courses.map((c) => ({
      code: c._id.code,
      name: c._id.name,
      lessons: c.lessons,
      earningsCents: c.earningsCents,
    })),
  };
}

// --- One learner (§24, §41 Phase 3) -----------------------------------------

/**
 * Who may read a learner's analytics, and how much of them.
 *
 * Three answers, resolved from stored records and never from a request:
 *
 *   **The owner** — the account that created the learner and pays for the
 *   lessons. Sees everything, including what the household has spent, because
 *   it is their own money.
 *
 *   **An administrator** — under the permission the route already required.
 *   Sees everything, for the same support reasons `/admin/progress` exists.
 *
 *   **A tutor who has actually taught them** — sees their *own* teaching and
 *   nothing else. Not the money (that is the family's), not the lessons the
 *   learner took with anybody else, and not another tutor's assessment. The
 *   test is a completed booking between this tutor and this learner, which is
 *   the same definition `progress.service` uses for who may write a report.
 *
 * Anyone else gets an authorization error, including a tutor who has only a
 * future booking: a lesson that has not happened is not teaching yet.
 */
async function resolveLearnerAccess(studentProfileId, actor) {
  const id =
    typeof studentProfileId === "string"
      ? new Types.ObjectId(studentProfileId)
      : studentProfileId;

  const student = await StudentProfile.findById(id)
    .select("ownerId firstName lastName gradeName gradeLevel isMinor shareFullNameWithTutor learningGoals archivedAt")
    .lean();
  if (!student) throw new NotFoundError("That learner no longer exists.");

  if (String(student.ownerId) === String(actor.id)) {
    return { id, student, scope: { full: true, tutorUserId: null } };
  }

  if (actor.role === ROLES.ADMIN) {
    return { id, student, scope: { full: true, tutorUserId: null } };
  }

  if (actor.role === ROLES.TUTOR) {
    const taught = await Booking.exists({
      studentProfileId: id,
      tutorUserId: new Types.ObjectId(actor.id),
      status: BOOKING_STATUS.COMPLETED,
    });
    if (taught) {
      return {
        id,
        student,
        scope: { full: false, tutorUserId: new Types.ObjectId(actor.id) },
      };
    }
  }

  throw new AuthorizationError("You do not have access to this learner's progress.");
}

/**
 * One learner's own analytics (§24, §41 Phase 3).
 *
 * Every figure below is aggregated in MongoDB from a record that already
 * existed for another reason — a booking that was taught, a payment that
 * settled, a report a tutor wrote, a goal a family set. Nothing here invents
 * a metric, estimates one, or fills an empty period with anything other than
 * zero: a learner who has had no lessons this month has had no lessons this
 * month, and the screen says so.
 *
 * The three rules that hold the admin figures together hold here too —
 * money comes from `Payment` on `paidAt`, lessons are matched on `startAt`,
 * and nothing is reduced from a paged array.
 */
export async function studentAnalytics(studentProfileId, actor, options = {}) {
  const range = resolveRange(options);
  const { id, student, scope } = await resolveLearnerAccess(studentProfileId, actor);

  // The scope is applied as a `$match` fragment carried into every pipeline,
  // so a tutor's view is narrowed once, here, rather than in eight places
  // that each have to remember.
  const mine = { studentProfileId: id };
  if (!scope.full) mine.tutorUserId = scope.tutorUserId;

  const [lessons, previous, series, courses, tutors, reports, milestones, spend] =
    await Promise.all([
      lessonAggregate(range, mine),
      lessonAggregate(range.previous, mine),

      Booking.aggregate([
        {
          $match: {
            ...mine,
            status: { $nin: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED] },
            ...dateWindow("startAt", range),
          },
        },
        {
          $group: {
            _id: bucketExpression("startAt", range),
            lessons: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] },
            },
            minutes: {
              $sum: {
                $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, "$durationMinutes", 0],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // What they are actually working on, by lessons taught.
      Booking.aggregate([
        {
          $match: {
            ...mine,
            status: BOOKING_STATUS.COMPLETED,
            ...dateWindow("startAt", range),
          },
        },
        {
          $group: {
            _id: { code: "$courseCode", name: "$courseName" },
            lessons: { $sum: 1 },
            minutes: { $sum: "$durationMinutes" },
          },
        },
        { $sort: { lessons: -1, "_id.name": 1 } },
        { $limit: 8 },
      ]),

      /**
       * Who taught them.
       *
       * Full scope only. A tutor asking about a learner they teach has no
       * business learning which *other* tutors that family uses — that is the
       * household's information, not a fact about this tutor's teaching.
       */
      scope.full
        ? Booking.aggregate([
            {
              $match: {
                ...mine,
                status: BOOKING_STATUS.COMPLETED,
                ...dateWindow("startAt", range),
              },
            },
            { $group: { _id: "$tutorUserId", lessons: { $sum: 1 } } },
            { $sort: { lessons: -1 } },
            { $limit: 8 },
          ])
        : Promise.resolve([]),

      /**
       * How the tutors who wrote reports rated them.
       *
       * Only submitted reports: a draft is the tutor's workspace and is not
       * something the family has been shown, so it must not move a number the
       * family is looking at. A tutor's scoped view sees only their own.
       */
      ProgressReport.aggregate([
        {
          $match: {
            studentProfileId: id,
            status: {
              $in: [PROGRESS_REPORT_STATUS.SUBMITTED, PROGRESS_REPORT_STATUS.ACKNOWLEDGED],
            },
            ...(scope.full ? {} : { tutorUserId: scope.tutorUserId }),
            ...dateWindow("submittedAt", range),
          },
        },
        {
          $group: {
            _id: null,
            reports: { $sum: 1 },
            acknowledged: {
              $sum: { $cond: [{ $ifNull: ["$acknowledgedAt", false] }, 1, 0] },
            },
            understanding: { $avg: "$ratings.understanding" },
            effort: { $avg: "$ratings.effort" },
            participation: { $avg: "$ratings.participation" },
            homework: { $avg: "$ratings.homework" },
          },
        },
      ]),

      // Milestones are additive and never un-earned, so they are counted over
      // the window in which they were recorded.
      ProgressReport.aggregate([
        {
          $match: {
            studentProfileId: id,
            status: {
              $in: [PROGRESS_REPORT_STATUS.SUBMITTED, PROGRESS_REPORT_STATUS.ACKNOWLEDGED],
            },
            ...(scope.full ? {} : { tutorUserId: scope.tutorUserId }),
            ...dateWindow("submittedAt", range),
          },
        },
        { $unwind: "$milestones" },
        { $group: { _id: null, count: { $sum: 1 } } },
      ]),

      scope.full ? learnerSpend(student.ownerId, id, range) : Promise.resolve(null),
    ]);

  const ratings = reports[0] ?? {};
  const goals = student.learningGoals ?? [];

  return {
    learner: {
      id: String(student._id),
      // The tutor's view is masked exactly as it is everywhere else (§35).
      displayName: scope.full
        ? `${student.firstName} ${student.lastName ?? ""}`.trim()
        : learnerDisplayName(student),
      gradeName: student.gradeName ?? null,
    },
    period: describe(range),
    scope: scope.full ? "FULL" : "TUTOR",

    lessons: {
      total: lessons.lessons,
      completed: lessons.completed,
      completedChange: percentChange(lessons.completed, previous.completed),
      cancelled: lessons.cancelled,
      cancelledByUs: lessons.cancelledByStudent,
      missed: lessons.studentNoShows,
      /** Of the lessons that were meant to happen, how many did. */
      attendanceRate: rate(lessons.completed, lessons.completed + lessons.studentNoShows),
      completionRate: lessons.completionRate,
      hoursLearned: Math.round(lessons.teachingMinutes / 60),
      fromPackage: lessons.fromPackage,
      inGroup: lessons.inGroup,
    },

    granularity: range.granularity,
    series: series.map((d) => ({
      date: d._id,
      lessons: d.lessons,
      completed: d.completed,
      minutes: d.minutes,
    })),

    courses: courses.map((c) => ({
      code: c._id.code ?? null,
      name: c._id.name ?? null,
      lessons: c.lessons,
      hours: Math.round((c.minutes / 60) * 10) / 10,
    })),

    tutors: { count: tutors.length, lessons: tutors.map((t) => t.lessons) },

    feedback: {
      reports: ratings.reports ?? 0,
      acknowledged: ratings.acknowledged ?? 0,
      /** `null`, not `0`, where nobody has rated it — an unrated skill is
       *  not a skill rated zero, and the screen renders the two differently. */
      understanding: roundRating(ratings.understanding),
      effort: roundRating(ratings.effort),
      participation: roundRating(ratings.participation),
      homework: roundRating(ratings.homework),
    },

    goals: {
      total: goals.length,
      achieved: goals.filter((g) => g.achievedAt).length,
      open: goals.filter((g) => !g.achievedAt).length,
      milestones: milestones[0]?.count ?? 0,
    },

    /** Absent — not zero — for a tutor, who is never shown the family's money. */
    spend,
  };
}

/** A rating nobody has given is null, not zero. */
function roundRating(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

/**
 * What this household paid for one learner's lessons, in one window.
 *
 * From `Payment` on `paidAt`, like every other money figure in this file, and
 * narrowed to the payments that are *for this learner* by joining to the
 * booking each one settled. The `purchaserId` match comes first so the join
 * runs over one household's payments rather than the platform's.
 *
 * Package purchases are deliberately excluded. A package is bought by the
 * household and can be drawn down by any of its learners, so attributing one
 * to a single child would be a guess — and a guess with a dollar sign in
 * front of it is the kind of number a family would reasonably act on. The
 * figure is named for what it actually counts.
 */
async function learnerSpend(ownerId, studentProfileId, range) {
  const [row] = await Payment.aggregate([
    {
      $match: {
        purchaserId: typeof ownerId === "string" ? new Types.ObjectId(ownerId) : ownerId,
        status: { $in: SETTLED_PAYMENT_STATUSES },
        bookingId: { $ne: null },
        ...dateWindow("paidAt", range),
      },
    },
    {
      $lookup: {
        from: Booking.collection.name,
        localField: "bookingId",
        foreignField: "_id",
        as: "booking",
      },
    },
    { $unwind: "$booking" },
    { $match: { "booking.studentProfileId": studentProfileId } },
    {
      $group: {
        _id: null,
        payments: { $sum: 1 },
        chargedCents: { $sum: "$totalCents" },
        refundedCents: { $sum: { $ifNull: ["$refundedCents", 0] } },
        creditAppliedCents: { $sum: { $ifNull: ["$creditAppliedCents", 0] } },
      },
    },
  ]);

  const base = row ?? {
    payments: 0,
    chargedCents: 0,
    refundedCents: 0,
    creditAppliedCents: 0,
  };

  return {
    ...base,
    netCents: base.chargedCents - base.refundedCents,
    /** Named so nobody reads it as "everything this family has spent". */
    excludesPackagePurchases: true,
  };
}

/** Counters the admin sidebar shows as badges. */
export async function adminQueueCounts() {
  const [
    pendingApplications,
    openDisputes,
    reportedReviews,
    pendingVerifications,
    reportedConversations,
    openRiskCases,
  ] = await Promise.all([
    TutorApplication.countDocuments({ status: TUTOR_STATUS.PENDING_REVIEW }),
    Dispute.countDocuments({
      status: { $in: OPEN_DISPUTE_STATUSES },
    }),
    Review.countDocuments({ reportStatus: { $in: ACTIVE_REPORT_STATUSES } }),
    VerificationRecord.countDocuments({ status: "PENDING" }),
    Conversation.countDocuments({ reportStatus: { $in: ACTIVE_REPORT_STATUSES } }),
    RiskCase.countDocuments({ status: { $in: OPEN_RISK_CASE_STATUSES } }),
  ]);

  return {
    pendingApplications,
    openDisputes,
    reportedReviews,
    pendingVerifications,
    reportedConversations,
    openRiskCases,
  };
}

/** Recent activity feed for the admin overview. */
export async function recentActivity({ limit = 10 } = {}) {
  const [bookings, applications, payments] = await Promise.all([
    Booking.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("reference courseName courseCode startAt status price createdAt")
      .lean(),
    TutorApplication.find({ status: TUTOR_STATUS.PENDING_REVIEW })
      .sort({ submittedAt: -1 })
      .limit(limit)
      .populate("userId", "firstName lastName email")
      .lean(),
    Payment.find({ status: PAYMENT_STATUS.PAID })
      .sort({ paidAt: -1 })
      .limit(limit)
      .select("totalCents commissionCents paidAt receiptNumber")
      .lean(),
  ]);

  return {
    bookings: toPlain(bookings),
    applications: toPlain(applications),
    payments: toPlain(payments),
  };
}

/** The period, in the shape every response reports it. */
function describe(range) {
  return {
    days: range.days,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    timeZone: range.timeZone,
    granularity: range.granularity,
    /** Kept for readers written against the previous shape. */
    since: range.from.toISOString(),
  };
}

/** Re-exported so callers can describe a period without reaching into lib. */
export { resolveRange };
