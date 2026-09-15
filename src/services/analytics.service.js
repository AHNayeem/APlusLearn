import "server-only";
import {
  User,
  TutorProfile,
  TutorApplication,
  Booking,
  Payment,
  Review,
  Dispute,
  StudentProfile,
  VerificationRecord,
} from "@/models";
import {
  ROLES,
  USER_STATUS,
  TUTOR_STATUS,
  BOOKING_STATUS,
  DISPUTE_STATUS,
  LESSON_MODES,
} from "@/constants";
import { toPlain } from "@/lib/utils/serialize";

/**
 * Marketplace analytics (§25).
 *
 * Every metric answers an operational question — supply, demand, revenue,
 * where growth is coming from — rather than existing to fill a chart.
 */

export async function marketplaceOverview({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  const previousSince = new Date(Date.now() - days * 2 * 86400000);

  const [
    registeredTutors,
    approvedTutors,
    pendingApplications,
    activeStudents,
    totalLearners,
    bookingStats,
    previousBookingStats,
    newRegistrations,
    previousRegistrations,
    openDisputes,
    pendingReviews,
  ] = await Promise.all([
    User.countDocuments({ role: ROLES.TUTOR, deletedAt: null }),
    TutorProfile.countDocuments({ status: TUTOR_STATUS.APPROVED, isSearchable: true }),
    TutorApplication.countDocuments({ status: TUTOR_STATUS.PENDING_REVIEW }),
    // "Active" means they have actually booked inside the window.
    Booking.distinct("purchaserId", { createdAt: { $gte: since } }),
    StudentProfile.countDocuments({ archivedAt: null }),
    bookingAggregate(since),
    bookingAggregate(previousSince, since),
    User.countDocuments({ createdAt: { $gte: since }, deletedAt: null }),
    User.countDocuments({ createdAt: { $gte: previousSince, $lt: since }, deletedAt: null }),
    Dispute.countDocuments({
      status: { $in: [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW] },
    }),
    Review.countDocuments({ status: "REPORTED" }),
  ]);

  return {
    period: { days, since: since.toISOString() },
    supply: {
      registeredTutors,
      approvedTutors,
      pendingApplications,
      approvalRate: registeredTutors ? Math.round((approvedTutors / registeredTutors) * 100) : 0,
    },
    demand: {
      activeStudents: activeStudents.length,
      totalLearners,
      newRegistrations,
      registrationChange: percentChange(newRegistrations, previousRegistrations),
    },
    commerce: {
      bookings: bookingStats.bookings,
      bookingChange: percentChange(bookingStats.bookings, previousBookingStats.bookings),
      grossSalesCents: bookingStats.grossCents,
      grossChange: percentChange(bookingStats.grossCents, previousBookingStats.grossCents),
      platformRevenueCents: bookingStats.commissionCents,
      tutorEarningsCents: bookingStats.tutorEarningsCents,
      averageBookingValueCents: bookingStats.bookings
        ? Math.round(bookingStats.grossCents / bookingStats.bookings)
        : 0,
      completedLessons: bookingStats.completed,
      cancellationRate: bookingStats.bookings
        ? Math.round((bookingStats.cancelled / bookingStats.bookings) * 100)
        : 0,
    },
    health: { openDisputes, pendingReviews },
  };
}

async function bookingAggregate(since, until) {
  const match = { createdAt: { $gte: since } };
  if (until) match.createdAt.$lt = until;

  const [row] = await Booking.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        bookings: { $sum: 1 },
        grossCents: { $sum: "$price.totalCents" },
        commissionCents: { $sum: "$price.commissionCents" },
        tutorEarningsCents: { $sum: "$price.tutorEarningsCents" },
        completed: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] },
        },
        cancelled: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$status",
                  [
                    BOOKING_STATUS.CANCELLED_BY_STUDENT,
                    BOOKING_STATUS.CANCELLED_BY_TUTOR,
                    BOOKING_STATUS.CANCELLED_BY_ADMIN,
                  ],
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  return (
    row ?? {
      bookings: 0,
      grossCents: 0,
      commissionCents: 0,
      tutorEarningsCents: 0,
      completed: 0,
      cancelled: 0,
    }
  );
}

function percentChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** Which subjects, courses and cities the marketplace actually runs on. */
export async function marketplaceBreakdowns({ days = 30, limit = 8 } = {}) {
  const since = new Date(Date.now() - days * 86400000);

  const [subjects, courses, cities, modes, dailyBookings] = await Promise.all([
    Booking.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: "$subjectName",
          bookings: { $sum: 1 },
          revenueCents: { $sum: "$price.totalCents" },
        },
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { bookings: -1 } },
      { $limit: limit },
    ]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { code: "$courseCode", name: "$courseName" },
          bookings: { $sum: 1 },
          revenueCents: { $sum: "$price.totalCents" },
        },
      },
      { $sort: { bookings: -1 } },
      { $limit: limit },
    ]),
    TutorProfile.aggregate([
      { $match: { isSearchable: true } },
      { $group: { _id: "$city", tutors: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { tutors: -1 } },
      { $limit: limit },
    ]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$mode", count: { $sum: 1 } } },
    ]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          bookings: { $sum: 1 },
          revenueCents: { $sum: "$price.totalCents" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const modeMap = Object.fromEntries(modes.map((m) => [m._id, m.count]));

  return {
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
    dailyBookings: dailyBookings.map((d) => ({
      date: d._id,
      bookings: d.bookings,
      revenueCents: d.revenueCents,
    })),
  };
}

/** Counters the admin sidebar shows as badges. */
export async function adminQueueCounts() {
  const [pendingApplications, openDisputes, reportedReviews, pendingVerifications] =
    await Promise.all([
      TutorApplication.countDocuments({ status: TUTOR_STATUS.PENDING_REVIEW }),
      Dispute.countDocuments({
        status: { $in: [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW] },
      }),
      Review.countDocuments({ status: "REPORTED" }),
      VerificationRecord.countDocuments({ status: "PENDING" }),
    ]);

  return { pendingApplications, openDisputes, reportedReviews, pendingVerifications };
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
    Payment.find({ status: "PAID" })
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
