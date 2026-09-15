import "server-only";
import { Types } from "mongoose";
import {
  Booking,
  TutorProfile,
  StudentProfile,
  Course,
  Availability,
  Payment,
  User,
} from "@/models";
import {
  BOOKING_STATUS,
  BLOCKING_BOOKING_STATUSES,
  CANCELLED_STATUSES,
  LESSON_MODES,
  MEETING_PROVIDERS,
  RECURRENCE,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
  FEATURES,
} from "@/constants";
import {
  NotFoundError,
  BusinessRuleError,
  AuthorizationError,
  ConflictError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { addDays, addMinutes } from "@/lib/utils/time";
import { formatDate, formatTime, formatMoney, formatDuration, publicName } from "@/lib/utils/format";
import { calculateLessonPrice, calculateSeriesTotal, rateForCourse } from "@/lib/booking/pricing";
import {
  resolveCancellation,
  resolveNoShow,
  canCancel,
  canComplete,
  assessCancellationAbuse,
  cancellationPolicyText,
} from "@/lib/booking/policy";
import { isSlotBookable } from "@/lib/booking/slots";
import { getSettings } from "./settings.service";
import { getMeetingProvider } from "./external/meeting-provider";
import { brandedEmailTemplates } from "./external/email-provider";
import { createPaymentForBooking, refundPayment } from "./payment.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import { refreshNextAvailable } from "./availability.service";
import { refreshTutorStats } from "./tutor.service";

/**
 * Booking lifecycle (§19, §26).
 *
 * Prices, commission and every state transition are computed here from
 * database state. The client supplies *intent* (who, what, when) and nothing
 * else — no amounts, no statuses (§42).
 */

// --- Quote (price preview before checkout) ---------------------------------

export async function quoteBooking({ tutorProfileId, courseId, durationMinutes, occurrences = 1 }) {
  const [tutor, settings] = await Promise.all([
    TutorProfile.findById(tutorProfileId).lean(),
    getSettings(),
  ]);
  if (!tutor) throw new NotFoundError("That tutor is no longer available.");

  assertTutorTeachesCourse(tutor, courseId);

  const lesson = calculateLessonPrice({
    hourlyRateCents: rateForCourse(tutor, courseId),
    durationMinutes,
    commissionPercent: settings.commissionPercent,
  });

  return {
    lesson,
    series: calculateSeriesTotal(lesson, occurrences),
    cancellationPolicy: cancellationPolicyText(settings),
  };
}

function assertTutorTeachesCourse(tutor, courseId) {
  const teaches = (tutor.courses ?? []).some((c) => String(c.courseId) === String(courseId));
  if (!teaches) {
    throw new BusinessRuleError("This tutor does not teach that course.", "COURSE_NOT_TAUGHT");
  }
}

// --- Create ----------------------------------------------------------------

/**
 * Create a booking (or a recurring series).
 *
 * Bookings start in PENDING_PAYMENT and are only CONFIRMED once the payment
 * service reports success, so an abandoned checkout never blocks a tutor's
 * calendar indefinitely.
 */
export async function createBooking(input, actor) {
  const settings = await getSettings();

  const [tutor, student, course] = await Promise.all([
    TutorProfile.findById(input.tutorProfileId).populate("userId", "firstName lastName email").lean(),
    StudentProfile.findById(input.studentProfileId).lean(),
    Course.findById(input.courseId).lean(),
  ]);

  if (!tutor) throw new NotFoundError("That tutor is no longer available.");
  if (!student) throw new NotFoundError("Choose who the lesson is for.");
  if (!course) throw new NotFoundError("That course is no longer available.");

  // Ownership: the learner must belong to the person paying (§8).
  if (String(student.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only book lessons for your own students.");
  }

  if (!tutor.isSearchable) {
    throw new BusinessRuleError("This tutor is not currently accepting bookings.");
  }
  if (!tutor.acceptingNewStudents) {
    const hasHistory = await Booking.exists({
      tutorProfileId: tutor._id,
      purchaserId: actor.id,
      status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CONFIRMED] },
    });
    if (!hasHistory) {
      throw new BusinessRuleError("This tutor is not taking new students right now.");
    }
  }

  assertTutorTeachesCourse(tutor, input.courseId);

  if (!tutor.lessonModes.includes(input.mode)) {
    throw new BusinessRuleError("This tutor does not offer that lesson type.");
  }

  // A lesson mode the operator has switched off platform-wide is refused here,
  // in the service, so the rule holds for every caller — the booking form, a
  // direct API call and the admin console alike (§26).
  const modeFeature =
    input.mode === LESSON_MODES.ONLINE ? FEATURES.ONLINE_LESSONS : FEATURES.IN_PERSON_LESSONS;
  if (settings.features?.[modeFeature] === false) {
    throw new BusinessRuleError(
      input.mode === LESSON_MODES.ONLINE
        ? "Online lessons are not available on this platform right now."
        : "In-person lessons are not available on this platform right now.",
      "LESSON_MODE_UNAVAILABLE",
    );
  }

  const availability = await Availability.findOne({ tutorProfileId: tutor._id }).lean();
  if (!availability) {
    throw new BusinessRuleError("This tutor has not published any availability yet.");
  }

  // Work out every instant in the series up front.
  const startTimes = seriesStartTimes(input.startAt, input.recurrence, input.occurrences);
  const lastEnd = addMinutes(startTimes.at(-1), input.durationMinutes);

  const existing = await Booking.find({
    tutorProfileId: tutor._id,
    status: { $in: BLOCKING_BOOKING_STATUSES },
    startAt: { $lt: lastEnd },
    endAt: { $gt: new Date(startTimes[0]) },
  })
    .select("startAt endAt")
    .lean();

  // Validate every occurrence before writing any of them.
  for (const startAt of startTimes) {
    const check = isSlotBookable({
      availability,
      bookings: existing,
      startAt,
      durationMinutes: input.durationMinutes,
      settings,
    });
    if (!check.bookable) {
      throw new ConflictError(
        startTimes.length > 1
          ? `${formatDate(startAt, { weekday: "short" })} at ${formatTime(startAt, tutor.timeZone)} is not available: ${check.reason}`
          : check.reason,
      );
    }
  }

  const price = calculateLessonPrice({
    hourlyRateCents: rateForCourse(tutor, input.courseId),
    durationMinutes: input.durationMinutes,
    commissionPercent: settings.commissionPercent,
  });

  const seriesId = new Types.ObjectId();
  const created = [];

  for (const [index, startAt] of startTimes.entries()) {
    const start = new Date(startAt);
    const end = addMinutes(start, input.durationMinutes);

    const booking = await Booking.create({
      reference: publicReference("APL"),
      purchaserId: actor.id,
      studentProfileId: student._id,
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId._id ?? tutor.userId,
      courseId: course._id,
      courseName: course.name,
      courseCode: course.code,
      subjectName: course.subjectName,
      mode: input.mode,
      location: input.mode === LESSON_MODES.IN_PERSON ? input.location : undefined,
      startAt: start,
      endAt: end,
      durationMinutes: input.durationMinutes,
      timeZone: tutor.timeZone ?? availability.timeZone,
      status: BOOKING_STATUS.PENDING_PAYMENT,
      price,
      recurrence: input.recurrence,
      seriesId: input.recurrence === RECURRENCE.NONE ? undefined : seriesId,
      seriesIndex: index,
      studentNotes: input.studentNotes,
    });

    // Reserve the slot against subsequent occurrences in this same series.
    existing.push({ startAt: start, endAt: end });
    created.push(booking);
  }

  // One payment covers the whole series.
  const payment = await createPaymentForBooking({
    bookings: created,
    purchaserId: actor.id,
    tutorUserId: tutor.userId._id ?? tutor.userId,
  });

  await Booking.updateMany(
    { _id: { $in: created.map((b) => b._id) } },
    { $set: { paymentId: payment.id } },
  );

  return {
    bookings: toPlain(created),
    payment,
    total: calculateSeriesTotal(price, created.length),
    meetingProvider: input.meetingProvider,
  };
}

/** Start instants for a one-off or recurring series. */
function seriesStartTimes(startAt, recurrence, occurrences) {
  const first = new Date(startAt);
  if (recurrence === RECURRENCE.NONE) return [first];

  const step = recurrence === RECURRENCE.BIWEEKLY ? 14 : 7;
  return Array.from({ length: occurrences }, (_, i) => addDays(first, i * step));
}

/**
 * Confirm after successful payment. Online lessons get their meeting link
 * here, once there is actually something to attend (§27).
 */
export async function confirmBookings(paymentId, { meetingProvider } = {}) {
  const bookings = await Booking.find({ paymentId, status: BOOKING_STATUS.PENDING_PAYMENT });
  if (!bookings.length) return { confirmed: 0 };

  const confirmed = [];

  for (const booking of bookings) {
    booking.status = BOOKING_STATUS.CONFIRMED;
    booking.confirmedAt = new Date();

    if (booking.mode === LESSON_MODES.ONLINE) {
      booking.meeting = await createMeetingFor(booking, meetingProvider);
    }

    await booking.save();
    confirmed.push(booking);
  }

  await Promise.all([
    refreshNextAvailable(confirmed[0].tutorProfileId),
    notifyBookingConfirmed(confirmed),
  ]);

  return { confirmed: confirmed.length, bookings: toPlain(confirmed) };
}

/**
 * Create the meeting room for an online lesson (§27).
 *
 * A meeting provider being down must not strand a lesson the student has
 * already paid for: the booking still confirms, and the link is filled in on
 * the next reschedule or by an administrator. The join URL is private to the
 * two participants — `getBooking()` is what enforces that.
 */
async function createMeetingFor(booking, requestedProvider) {
  const provider = requestedProvider ?? MEETING_PROVIDERS.ZOOM;
  try {
    return await getMeetingProvider().createMeeting({
      provider,
      topic: `${booking.courseName} lesson`,
      agenda: booking.courseCode ? `${booking.courseName} (${booking.courseCode})` : undefined,
      startAt: booking.startAt,
      durationMinutes: booking.durationMinutes,
      timeZone: booking.timeZone,
    });
  } catch (error) {
    console.error(`[booking] meeting creation failed for ${booking.reference}:`, error.message);
    return undefined;
  }
}

/** Tear a room down so a cancelled lesson's link stops working. */
async function releaseMeetingFor(booking) {
  if (!booking.meeting?.meetingId) return;
  try {
    await getMeetingProvider().deleteMeeting({ meetingId: booking.meeting.meetingId });
  } catch (error) {
    console.error(`[booking] meeting teardown failed for ${booking.reference}:`, error.message);
  }
}

async function notifyBookingConfirmed(bookings) {
  const first = bookings[0];
  const [purchaser, tutorUser, student] = await Promise.all([
    User.findById(first.purchaserId).select("firstName email").lean(),
    User.findById(first.tutorUserId).select("firstName lastName email").lean(),
    StudentProfile.findById(first.studentProfileId).select("firstName lastName isMinor shareFullNameWithTutor").lean(),
  ]);

  const countLabel =
    bookings.length > 1 ? `${bookings.length} lessons` : "Your lesson";
  const tutorName = publicName(tutorUser?.firstName ?? "", tutorUser?.lastName ?? "");

  await notify({
    userId: first.purchaserId,
    type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
    title: `${countLabel} with ${tutorName} ${bookings.length > 1 ? "are" : "is"} confirmed`,
    body: `${first.courseName} on ${formatDate(first.startAt, { weekday: "short", timeZone: first.timeZone })} at ${formatTime(first.startAt, first.timeZone)}.`,
    href: `/bookings/${first._id}`,
    entityType: "Booking",
    entityId: first._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
    email: (await brandedEmailTemplates()).bookingConfirmed({
      firstName: purchaser?.firstName ?? "there",
      booking: bookingEmailPayload(first, tutorName),
    }),
  });

  const studentName = student
    ? student.isMinor && !student.shareFullNameWithTutor
      ? `${student.firstName} ${student.lastName?.charAt(0) ?? ""}.`
      : `${student.firstName} ${student.lastName ?? ""}`.trim()
    : "your student";

  await notify({
    userId: first.tutorUserId,
    type: NOTIFICATION_TYPES.BOOKING_CREATED,
    title: `New booking from ${studentName}`,
    body: `${first.courseName} on ${formatDate(first.startAt, { weekday: "short", timeZone: first.timeZone })} at ${formatTime(first.startAt, first.timeZone)}.`,
    href: `/tutor/bookings/${first._id}`,
    entityType: "Booking",
    entityId: first._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
    email: (await brandedEmailTemplates()).bookingConfirmed({
      firstName: tutorUser?.firstName ?? "there",
      booking: bookingEmailPayload(first, studentName),
    }),
  });
}

function bookingEmailPayload(booking, otherPartyName) {
  return {
    id: String(booking._id),
    reference: booking.reference,
    courseName: booking.courseName,
    courseCode: booking.courseCode,
    tutorName: otherPartyName,
    dateLabel: formatDate(booking.startAt, { weekday: "long", timeZone: booking.timeZone }),
    timeLabel: formatTime(booking.startAt, booking.timeZone),
    durationLabel: formatDuration(booking.durationMinutes),
    modeLabel: booking.mode === LESSON_MODES.ONLINE ? "Online" : "In person",
    totalLabel: formatMoney(booking.price.totalCents),
  };
}

// --- Reads -----------------------------------------------------------------

export async function listBookings(actor, params = {}) {
  const pageSize = params.pageSize ?? PAGE_SIZES.bookings;
  const query = scopeQueryForActor(actor, params);

  const now = new Date();
  switch (params.scope) {
    case "UPCOMING":
      query.startAt = { $gte: now };
      query.status = { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PENDING_PAYMENT] };
      break;
    case "PAST":
      query.startAt = { $lt: now };
      query.status = {
        $in: [
          BOOKING_STATUS.COMPLETED,
          BOOKING_STATUS.NO_SHOW_STUDENT,
          BOOKING_STATUS.NO_SHOW_TUTOR,
          BOOKING_STATUS.DISPUTED,
        ],
      };
      break;
    case "CANCELLED":
      query.status = { $in: CANCELLED_STATUSES };
      break;
    case "AWAITING_REVIEW":
      query.status = BOOKING_STATUS.COMPLETED;
      query.reviewId = { $exists: false };
      break;
    default:
      break;
  }

  if (params.status) query.status = params.status;
  if (params.studentProfileId) query.studentProfileId = params.studentProfileId;

  const sortDir = params.scope === "UPCOMING" ? 1 : -1;

  const [items, total] = await Promise.all([
    Booking.find(query)
      .sort({ startAt: sortDir })
      .skip((params.page - 1) * pageSize)
      .limit(pageSize)
      .populate("studentProfileId", "firstName lastName avatarUrl isMinor shareFullNameWithTutor")
      .populate({
        path: "tutorProfileId",
        select: "slug city province userId hourlyRateCents",
        populate: { path: "userId", select: "firstName lastName avatarUrl" },
      })
      .lean(),
    Booking.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page: params.page, pageSize };
}

function scopeQueryForActor(actor, params) {
  if (actor.role === ROLES.TUTOR) {
    return { tutorUserId: actor.id };
  }
  if (actor.role === ROLES.ADMIN) {
    const query = {};
    if (params.tutorProfileId) query.tutorProfileId = params.tutorProfileId;
    return query;
  }
  return { purchaserId: actor.id };
}

/** A single booking, with access enforced by participation (§8). */
export async function getBooking(id, actor) {
  const booking = await Booking.findById(id)
    .populate("studentProfileId", "firstName lastName avatarUrl isMinor shareFullNameWithTutor gradeName")
    .populate({
      path: "tutorProfileId",
      select: "slug city province timeZone userId hourlyRateCents verifiedTypes stats",
      populate: { path: "userId", select: "firstName lastName avatarUrl email phone" },
    })
    .populate("paymentId")
    .lean();

  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const allowed =
    actor.role === ROLES.ADMIN ||
    String(booking.purchaserId) === String(actor.id) ||
    String(booking.tutorUserId) === String(actor.id);

  if (!allowed) throw new AuthorizationError("You do not have access to this lesson.");

  const plain = toPlain(booking);

  // The in-person street address is released only to the two parties, and
  // only once the lesson is actually confirmed (§27, §42).
  if (booking.mode === LESSON_MODES.IN_PERSON && booking.location) {
    const canSeeAddress =
      booking.status === BOOKING_STATUS.CONFIRMED || booking.status === BOOKING_STATUS.COMPLETED;
    if (canSeeAddress) {
      const withAddress = await Booking.findById(id).select("+location.addressLine").lean();
      plain.location = toPlain(withAddress.location);
    }
  }

  const settings = await getSettings();
  plain.permissions = {
    canCancel: canCancel(booking, actorRoleFor(booking, actor)),
    canComplete: canComplete(booking) && String(booking.tutorUserId) === String(actor.id),
    canReview:
      booking.status === BOOKING_STATUS.COMPLETED &&
      !booking.reviewId &&
      String(booking.purchaserId) === String(actor.id),
    canDispute:
      [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.NO_SHOW_STUDENT, BOOKING_STATUS.NO_SHOW_TUTOR].includes(
        booking.status,
      ) && booking.status !== BOOKING_STATUS.DISPUTED,
  };
  plain.cancellationPolicy = cancellationPolicyText(settings);

  return plain;
}

function actorRoleFor(booking, actor) {
  if (actor.role === ROLES.ADMIN) return "ADMIN";
  if (String(booking.tutorUserId) === String(actor.id)) return "TUTOR";
  return "STUDENT";
}

// --- Cancellation (§26) ----------------------------------------------------

export async function cancelBooking(id, { reason, cancelSeries }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const role = actorRoleFor(booking, actor);
  if (
    role === "STUDENT" &&
    String(booking.purchaserId) !== String(actor.id) &&
    actor.role !== ROLES.ADMIN
  ) {
    throw new AuthorizationError("You can only cancel your own lessons.");
  }
  if (!canCancel(booking, role)) {
    throw new BusinessRuleError("This lesson can no longer be cancelled.", "NOT_CANCELLABLE");
  }

  const settings = await getSettings();

  const targets =
    cancelSeries && booking.seriesId
      ? await Booking.find({
          seriesId: booking.seriesId,
          status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PENDING_PAYMENT] },
          startAt: { $gte: new Date() },
        })
      : [booking];

  let totalRefund = 0;
  const cancelled = [];

  for (const target of targets) {
    const outcome = resolveCancellation({
      startAt: target.startAt,
      totalCents: target.price.totalCents,
      cancelledBy: role === "ADMIN" ? "ADMIN" : role,
      settings,
    });

    target.status =
      role === "TUTOR"
        ? BOOKING_STATUS.CANCELLED_BY_TUTOR
        : role === "ADMIN"
          ? BOOKING_STATUS.CANCELLED_BY_ADMIN
          : BOOKING_STATUS.CANCELLED_BY_STUDENT;

    target.cancellation = {
      cancelledAt: new Date(),
      cancelledBy: actor.id,
      cancelledByRole: role,
      reason,
      hoursBeforeStart: outcome.hoursBeforeStart,
      refundPercent: outcome.refundPercent,
      refundCents: outcome.refundCents,
      policyApplied: outcome.policyApplied,
    };

    // The room outlives the lesson unless it is torn down, and a stale link
    // is a room two strangers could still walk into (§27).
    if (target.mode === LESSON_MODES.ONLINE) await releaseMeetingFor(target);

    await target.save();
    totalRefund += outcome.refundCents;
    cancelled.push(target);
  }

  if (totalRefund > 0 && booking.paymentId) {
    await refundPayment(booking.paymentId, {
      amountCents: totalRefund,
      reason: `Cancellation — ${cancelled[0].cancellation.policyApplied}`,
      issuedBy: actor.id,
    });
  }

  // A tutor cancelling frees the slot again.
  if (role === "TUTOR") {
    await TutorProfile.updateOne(
      { _id: booking.tutorProfileId },
      { $inc: { "stats.cancellationCount": cancelled.length } },
    );
  }
  await refreshNextAvailable(booking.tutorProfileId);

  const abuse = await assessAbuse(actor, role, settings);
  await notifyCancellation(cancelled, role, totalRefund);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.BOOKING_CANCELLED,
    entityType: "Booking",
    entityId: booking._id,
    metadata: { role, count: cancelled.length, refundCents: totalRefund, reason },
  });

  return {
    cancelled: cancelled.length,
    refundCents: totalRefund,
    policy: cancelled[0].cancellation,
    abuse,
  };
}

/** Track repeated cancellations and warn or flag the account (§26). */
async function assessAbuse(actor, role, settings) {
  if (role === "ADMIN") return { action: "NONE" };

  const since = addDays(new Date(), -settings.cancellationAbuseWindowDays);
  const field = role === "TUTOR" ? "tutorUserId" : "purchaserId";
  const statuses =
    role === "TUTOR"
      ? [BOOKING_STATUS.CANCELLED_BY_TUTOR]
      : [BOOKING_STATUS.CANCELLED_BY_STUDENT];

  const count = await Booking.countDocuments({
    [field]: actor.id,
    status: { $in: statuses },
    "cancellation.cancelledAt": { $gte: since },
  });

  const assessment = assessCancellationAbuse(count, settings);

  if (assessment.action !== "NONE") {
    await notify({
      userId: actor.id,
      type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
      title:
        assessment.action === "WARN"
          ? "A note about your cancellations"
          : "Your account is under review",
      body: assessment.message,
      href: role === "TUTOR" ? "/tutor/bookings" : "/bookings",
    });
  }

  return assessment;
}

async function notifyCancellation(bookings, role, refundCents) {
  const first = bookings[0];
  const label = bookings.length > 1 ? `${bookings.length} lessons were` : "Your lesson was";

  const recipients = [
    { userId: first.purchaserId, href: `/bookings/${first._id}`, isPurchaser: true },
    { userId: first.tutorUserId, href: `/tutor/bookings/${first._id}`, isPurchaser: false },
  ];

  const users = await User.find({ _id: { $in: recipients.map((r) => r.userId) } })
    .select("firstName")
    .lean();
  const nameOf = new Map(users.map((u) => [String(u._id), u.firstName]));

  for (const recipient of recipients) {
    // Only the person who paid is told about a refund; the refund figure
    // itself was resolved by lib/booking/policy, never recalculated here.
    const refundLabel =
      recipient.isPurchaser && refundCents > 0 ? formatMoney(refundCents) : null;

    await notify({
      userId: recipient.userId,
      type: NOTIFICATION_TYPES.BOOKING_CANCELLED,
      title: `${label} cancelled`,
      body: refundLabel
        ? `${first.courseName} on ${formatDate(first.startAt, { weekday: "short" })}. ${refundLabel} will be refunded.`
        : `${first.courseName} on ${formatDate(first.startAt, { weekday: "short" })}.`,
      href: recipient.href,
      entityType: "Booking",
      entityId: first._id,
      channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
      email: (await brandedEmailTemplates()).bookingCancelled({
        firstName: nameOf.get(String(recipient.userId)) ?? "there",
        booking: bookingEmailPayload(first, ""),
        refundLabel: refundLabel ?? (recipient.isPurchaser ? "None" : "—"),
      }),
    });
  }
}

// --- Completion and no-shows ----------------------------------------------

export async function completeBooking(id, { outcome, tutorNotes }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  if (String(booking.tutorUserId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("Only the tutor can complete a lesson.");
  }
  if (!canComplete(booking) && actor.role !== ROLES.ADMIN) {
    throw new BusinessRuleError(
      "A lesson can only be marked complete once it has finished.",
      "TOO_EARLY",
    );
  }

  booking.status = outcome;
  booking.completedAt = new Date();
  if (tutorNotes) booking.tutorNotes = tutorNotes;

  if (outcome === BOOKING_STATUS.NO_SHOW_STUDENT) {
    const settings = await getSettings();
    const refund = resolveNoShow({
      party: "STUDENT",
      totalCents: booking.price.totalCents,
      settings,
    });
    booking.cancellation = {
      cancelledAt: new Date(),
      cancelledBy: actor.id,
      cancelledByRole: "TUTOR",
      reason: "Student did not attend",
      refundPercent: refund.refundPercent,
      refundCents: refund.refundCents,
      policyApplied: refund.policyApplied,
    };
    if (refund.refundCents > 0 && booking.paymentId) {
      await refundPayment(booking.paymentId, {
        amountCents: refund.refundCents,
        reason: "Student no-show",
        issuedBy: actor.id,
      });
    }
  }

  await booking.save();
  await refreshTutorStats(booking.tutorProfileId);

  await notify({
    userId: booking.purchaserId,
    type: NOTIFICATION_TYPES.BOOKING_COMPLETED,
    title:
      outcome === BOOKING_STATUS.COMPLETED
        ? "How did the lesson go?"
        : "Your lesson was marked as a no-show",
    body:
      outcome === BOOKING_STATUS.COMPLETED
        ? `Leave a review for your ${booking.courseName} lesson to help other families.`
        : `Your tutor reported that nobody attended the ${booking.courseName} lesson.`,
    href: `/bookings/${booking._id}`,
    entityType: "Booking",
    entityId: booking._id,
  });

  return toPlain(booking);
}

/** A student reporting that the tutor did not attend (§26). */
export async function reportNoShow(id, { party, note }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const role = actorRoleFor(booking, actor);
  if (party === "TUTOR" && role !== "STUDENT" && role !== "ADMIN") {
    throw new AuthorizationError("Only the student can report a tutor no-show.");
  }
  if (party === "STUDENT" && role !== "TUTOR" && role !== "ADMIN") {
    throw new AuthorizationError("Only the tutor can report a student no-show.");
  }
  if (new Date(booking.endAt) > new Date()) {
    throw new BusinessRuleError("You can report a no-show once the lesson has finished.");
  }

  const settings = await getSettings();
  const refund = resolveNoShow({ party, totalCents: booking.price.totalCents, settings });

  booking.status =
    party === "TUTOR" ? BOOKING_STATUS.NO_SHOW_TUTOR : BOOKING_STATUS.NO_SHOW_STUDENT;
  booking.cancellation = {
    cancelledAt: new Date(),
    cancelledBy: actor.id,
    cancelledByRole: role,
    reason: note,
    refundPercent: refund.refundPercent,
    refundCents: refund.refundCents,
    policyApplied: refund.policyApplied,
  };
  await booking.save();

  if (refund.refundCents > 0 && booking.paymentId) {
    await refundPayment(booking.paymentId, {
      amountCents: refund.refundCents,
      reason: `${party === "TUTOR" ? "Tutor" : "Student"} no-show`,
      issuedBy: actor.id,
    });
  }

  const otherParty = party === "TUTOR" ? booking.tutorUserId : booking.purchaserId;
  await notify({
    userId: otherParty,
    type: NOTIFICATION_TYPES.BOOKING_CHANGED,
    title: "A no-show was reported",
    body: `${booking.courseName} on ${formatDate(booking.startAt, { weekday: "short" })} was reported as a no-show. If this is wrong, open a dispute.`,
    href: party === "TUTOR" ? `/tutor/bookings/${booking._id}` : `/bookings/${booking._id}`,
    entityType: "Booking",
    entityId: booking._id,
  });

  return toPlain(booking);
}

// --- Reschedule ------------------------------------------------------------

export async function rescheduleBooking(id, { startAt, durationMinutes, reason }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const role = actorRoleFor(booking, actor);
  if (booking.status !== BOOKING_STATUS.CONFIRMED) {
    throw new BusinessRuleError("Only a confirmed lesson can be rescheduled.");
  }

  const settings = await getSettings();
  const duration = durationMinutes ?? booking.durationMinutes;

  const [availability, clashes] = await Promise.all([
    Availability.findOne({ tutorProfileId: booking.tutorProfileId }).lean(),
    Booking.find({
      tutorProfileId: booking.tutorProfileId,
      _id: { $ne: booking._id },
      status: { $in: BLOCKING_BOOKING_STATUSES },
      startAt: { $lt: addMinutes(new Date(startAt), duration) },
      endAt: { $gt: new Date(startAt) },
    })
      .select("startAt endAt")
      .lean(),
  ]);

  const check = isSlotBookable({
    availability,
    bookings: clashes,
    startAt,
    durationMinutes: duration,
    settings,
  });
  if (!check.bookable) throw new ConflictError(check.reason);

  // The price is re-derived if the length changed — never carried over blindly.
  if (duration !== booking.durationMinutes) {
    booking.price = calculateLessonPrice({
      hourlyRateCents: booking.price.hourlyRateCents,
      durationMinutes: duration,
      commissionPercent: booking.price.commissionPercent,
    });
  }

  const previousLabel = `${formatDate(booking.startAt, { weekday: "long", timeZone: booking.timeZone })} at ${formatTime(booking.startAt, booking.timeZone)}`;

  booking.startAt = new Date(startAt);
  booking.endAt = addMinutes(new Date(startAt), duration);
  booking.durationMinutes = duration;

  // Move the existing room rather than issuing a new link, so a join link
  // already in someone's calendar keeps working (§27).
  if (booking.mode === LESSON_MODES.ONLINE) {
    if (booking.meeting?.meetingId) {
      try {
        await getMeetingProvider().updateMeeting({
          meetingId: booking.meeting.meetingId,
          topic: `${booking.courseName} lesson`,
          startAt: booking.startAt,
          durationMinutes: duration,
          timeZone: booking.timeZone,
        });
      } catch (error) {
        console.error(`[booking] meeting move failed for ${booking.reference}:`, error.message);
      }
    } else {
      // A lesson confirmed while the provider was down gets its room now.
      booking.meeting = await createMeetingFor(booking);
    }
  }

  await booking.save();

  await refreshNextAvailable(booking.tutorProfileId);

  const otherParty = role === "TUTOR" ? booking.purchaserId : booking.tutorUserId;
  const recipient = await User.findById(otherParty).select("firstName").lean();

  await notify({
    userId: otherParty,
    type: NOTIFICATION_TYPES.BOOKING_CHANGED,
    title: "A lesson was rescheduled",
    body: `${booking.courseName} is now on ${formatDate(booking.startAt, { weekday: "long", timeZone: booking.timeZone })} at ${formatTime(booking.startAt, booking.timeZone)}.${reason ? ` Reason: ${reason}` : ""}`,
    href: role === "TUTOR" ? `/bookings/${booking._id}` : `/tutor/bookings/${booking._id}`,
    entityType: "Booking",
    entityId: booking._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
    email: (await brandedEmailTemplates()).bookingRescheduled({
      firstName: recipient?.firstName ?? "there",
      booking: bookingEmailPayload(booking, ""),
      previousLabel,
      reason,
    }),
  });

  return toPlain(booking);
}

/** Dashboard summary counters (§24). */
export async function bookingSummary(actor) {
  const field = actor.role === ROLES.TUTOR ? "tutorUserId" : "purchaserId";
  const now = new Date();

  const [upcoming, completed, awaitingReview, nextLesson] = await Promise.all([
    Booking.countDocuments({
      [field]: actor.id,
      status: BOOKING_STATUS.CONFIRMED,
      startAt: { $gte: now },
    }),
    Booking.countDocuments({ [field]: actor.id, status: BOOKING_STATUS.COMPLETED }),
    actor.role === ROLES.TUTOR
      ? 0
      : Booking.countDocuments({
          [field]: actor.id,
          status: BOOKING_STATUS.COMPLETED,
          reviewId: { $exists: false },
        }),
    Booking.findOne({
      [field]: actor.id,
      status: BOOKING_STATUS.CONFIRMED,
      startAt: { $gte: now },
    })
      .sort({ startAt: 1 })
      .populate("studentProfileId", "firstName lastName isMinor shareFullNameWithTutor")
      .populate({
        path: "tutorProfileId",
        select: "slug userId",
        populate: { path: "userId", select: "firstName lastName avatarUrl" },
      })
      .lean(),
  ]);

  return {
    upcoming,
    completed,
    awaitingReview,
    nextLesson: nextLesson ? toPlain(nextLesson) : null,
  };
}
