import "server-only";
import {
  GroupSession,
  GroupEnrolment,
  Booking,
  TutorProfile,
  StudentProfile,
  Course,
  Availability,
  Payment,
} from "@/models";
import {
  GROUP_SESSION_STATUS,
  JOINABLE_GROUP_STATUSES,
  ACTIVE_GROUP_STATUSES,
  GROUP_ENROLMENT_STATUS,
  SEAT_HOLDING_ENROLMENT_STATUSES,
  ATTENDANCE,
  BOOKING_STATUS,
  BLOCKING_BOOKING_STATUSES,
  LESSON_MODES,
  MEETING_PROVIDERS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import {
  NotFoundError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { addMinutes } from "@/lib/utils/time";
import { formatDate, formatTime, learnerDisplayName } from "@/lib/utils/format";
import { calculateLessonPrice } from "@/lib/booking/pricing";
import { isSlotBookable } from "@/lib/booking/slots";
import { getSettings } from "./settings.service";
import { createPaymentForBooking, refundPayment } from "./payment.service";
import { getMeetingProvider } from "./external/meeting-provider";
import { externalBusyPeriods } from "./calendar.service";
import { refreshNextAvailable } from "./availability.service";
import { notify, notifyMany } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Group tutoring (§41 Phase 2).
 *
 * One tutor, one time, several learners. The design decision that everything
 * else follows from: each learner's place is an ordinary `Booking`, and the
 * `GroupSession` is only what those bookings have in common. So payment,
 * refunds, payouts, reviews, the cancellation policy and the tutor's calendar
 * all work exactly as they already did, and none of them is reimplemented.
 *
 * Three guarantees:
 *
 *   **No overbooking.** Taking a seat is one conditional update on the
 *   session document, so concurrent joins cannot both take the last seat and
 *   `seatsTaken` can never exceed `maxParticipants`.
 *
 *   **No duplicate enrolment.** A unique index on (session, learner), not
 *   only a check — two tabs would both pass a check.
 *
 *   **Nobody pays for a lesson that does not happen.** A session that has not
 *   reached its minimum by the deadline is cancelled and everybody is
 *   refunded in full.
 */

// --- Creating and publishing -----------------------------------------------

export async function createGroupSession(input, actor) {
  const settings = await getSettings();
  if (settings.groups?.enabled === false) {
    throw new BusinessRuleError("Group sessions are not available on this platform.", "GROUPS_DISABLED");
  }

  const [profile, course] = await Promise.all([
    TutorProfile.findOne({ userId: actor.id }).lean(),
    Course.findById(input.courseId).lean(),
  ]);

  if (!profile) throw new NotFoundError("You do not have a tutor profile.");
  if (!course) throw new NotFoundError("That course is no longer available.");
  if (!profile.isSearchable) {
    throw new BusinessRuleError(
      "Your profile must be approved before you can run group sessions.",
      "PROFILE_NOT_APPROVED",
    );
  }

  const teaches = (profile.courses ?? []).some((c) => String(c.courseId) === String(course._id));
  if (!teaches) throw new BusinessRuleError("You do not teach that course.", "COURSE_NOT_TAUGHT");
  if (!profile.lessonModes?.includes(input.mode)) {
    throw new BusinessRuleError("You do not offer that lesson type.", "MODE_NOT_OFFERED");
  }

  assertCapacity(input, settings);

  if (input.mode === LESSON_MODES.ONLINE) {
    const offered = profile.onlineMeetingProviders?.length
      ? profile.onlineMeetingProviders
      : [MEETING_PROVIDERS.ZOOM];
    if (!offered.includes(input.meetingProvider)) {
      throw new BusinessRuleError(
        "You do not teach on that meeting platform.",
        "MEETING_PROVIDER_UNAVAILABLE",
      );
    }
  }

  const startAt = new Date(input.startAt);
  const endAt = addMinutes(startAt, input.durationMinutes);

  const session = await GroupSession.create({
    reference: publicReference("GRP"),
    tutorProfileId: profile._id,
    tutorUserId: actor.id,
    title: input.title,
    description: input.description,
    courseId: course._id,
    courseCode: course.code,
    courseName: course.name,
    subjectName: course.subjectName,
    gradeLevel: course.gradeLevel,
    provinceCode: course.provinceCode,
    mode: input.mode,
    meetingProvider: input.mode === LESSON_MODES.ONLINE ? input.meetingProvider : undefined,
    location: input.mode === LESSON_MODES.IN_PERSON ? input.location : undefined,
    startAt,
    endAt,
    durationMinutes: input.durationMinutes,
    timeZone: profile.timeZone ?? "America/Toronto",
    minParticipants: input.minParticipants,
    maxParticipants: input.maxParticipants,
    pricePerSeatCents: input.pricePerSeatCents,
    commissionPercent: settings.commissionPercent,
    confirmBy: new Date(
      startAt.getTime() - (settings.groups?.confirmationDeadlineHours ?? 24) * 3600_000,
    ),
    status: GROUP_SESSION_STATUS.DRAFT,
  });

  return toPlain(session);
}

/**
 * Publish a session, which is the moment it reserves the tutor's time.
 *
 * The availability check happens here rather than at creation, because a
 * draft holds nothing and a tutor may well write one for a slot they intend
 * to free up. It also happens *once*, for the whole session — every learner
 * who joins afterwards is sharing the hour it already claimed.
 */
export async function publishGroupSession(id, actor) {
  const settings = await getSettings();
  const session = await ownedSession(id, actor);

  if (session.status !== GROUP_SESSION_STATUS.DRAFT) {
    throw new ConflictError("That session has already been published.");
  }
  if (session.startAt <= new Date()) {
    throw new BusinessRuleError("That session is in the past.", "SESSION_IN_PAST");
  }

  const open = await GroupSession.countDocuments({
    tutorProfileId: session.tutorProfileId,
    status: { $in: JOINABLE_GROUP_STATUSES },
  });
  if (open >= (settings.groups?.maxOpenPerTutor ?? 20)) {
    throw new BusinessRuleError(
      `You can have ${settings.groups.maxOpenPerTutor} sessions open at once.`,
      "GROUP_LIMIT_REACHED",
    );
  }

  const availability = await Availability.findOne({ tutorProfileId: session.tutorProfileId }).lean();
  if (!availability) {
    throw new BusinessRuleError("Publish your availability before running a group session.", "NO_AVAILABILITY");
  }

  // The same slot rules a one-to-one booking obeys — a group does not get to
  // sit on top of a lesson somebody already paid for (§18, §42).
  const [bookings, external] = await Promise.all([
    Booking.find({
      tutorProfileId: session.tutorProfileId,
      status: { $in: BLOCKING_BOOKING_STATUSES },
      startAt: { $lt: session.endAt },
      endAt: { $gt: session.startAt },
    })
      .select("startAt endAt")
      .lean(),
    externalBusyPeriods(session.tutorProfileId, { from: session.startAt, to: session.endAt }),
  ]);

  const check = isSlotBookable({
    availability,
    bookings: [...bookings, ...external],
    startAt: session.startAt,
    durationMinutes: session.durationMinutes,
    settings,
  });
  if (!check.bookable) throw new ConflictError(check.reason);

  const clashing = await GroupSession.exists({
    _id: { $ne: session._id },
    tutorProfileId: session.tutorProfileId,
    status: { $in: ACTIVE_GROUP_STATUSES },
    startAt: { $lt: session.endAt },
    endAt: { $gt: session.startAt },
  });
  if (clashing) {
    throw new ConflictError("You already have a group session at that time.");
  }

  session.status = GROUP_SESSION_STATUS.PUBLISHED;
  session.publishedAt = new Date();
  await session.save();

  await refreshNextAvailable(session.tutorProfileId);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.GROUP_SESSION_PUBLISHED,
    entityType: "GroupSession",
    entityId: session._id,
    metadata: { reference: session.reference, seats: session.maxParticipants },
  });

  return toPlain(session);
}

export async function updateGroupSession(id, input, actor) {
  const settings = await getSettings();
  const session = await ownedSession(id, actor);

  if (session.status === GROUP_SESSION_STATUS.CANCELLED) {
    throw new BusinessRuleError("That session has been cancelled.", "SESSION_CANCELLED");
  }

  const hasEnrolments = session.seatsTaken > 0;

  // Once somebody has paid to be there, the things they agreed to are fixed.
  const lockedFields = ["startAt", "durationMinutes", "pricePerSeatCents", "mode"];
  if (hasEnrolments) {
    for (const field of lockedFields) {
      if (input[field] !== undefined) {
        throw new BusinessRuleError(
          "People have already joined this session, so the time, price and format are fixed. Cancel it if you need to change them.",
          "SESSION_HAS_ENROLMENTS",
        );
      }
    }
  }

  if (input.maxParticipants !== undefined && input.maxParticipants < session.seatsTaken) {
    throw new BusinessRuleError(
      `${session.seatsTaken} people have already joined, so the limit cannot go below that.`,
      "CAPACITY_BELOW_ENROLMENTS",
    );
  }

  for (const field of ["title", "description", "minParticipants", "maxParticipants", ...lockedFields]) {
    if (input[field] === undefined) continue;
    session[field] = field === "startAt" ? new Date(input[field]) : input[field];
  }

  if (input.startAt !== undefined || input.durationMinutes !== undefined) {
    session.endAt = addMinutes(session.startAt, session.durationMinutes);
    session.confirmBy = new Date(
      session.startAt.getTime() - (settings.groups?.confirmationDeadlineHours ?? 24) * 3600_000,
    );
  }

  assertCapacity(session, settings);
  await session.save();

  return toPlain(session);
}

// --- Joining ---------------------------------------------------------------

/**
 * Join a session.
 *
 * The seat is claimed before the booking and the payment exist, because the
 * claim is the step that can legitimately fail. Claiming last would mean
 * charging somebody for a seat that turned out not to be there.
 */
export async function joinGroupSession(id, input, actor) {
  const settings = await getSettings();
  if (settings.groups?.enabled === false) {
    throw new BusinessRuleError("Group sessions are not available on this platform.", "GROUPS_DISABLED");
  }

  const [session, student] = await Promise.all([
    GroupSession.findById(id),
    StudentProfile.findById(input.studentProfileId).lean(),
  ]);

  if (!session) throw new NotFoundError("That session no longer exists.");
  if (!student) throw new NotFoundError("Choose who the lesson is for.");

  // Ownership against the loaded record, never a request field (§42).
  if (String(student.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only book lessons for your own students.");
  }
  if (!JOINABLE_GROUP_STATUSES.includes(session.status)) {
    throw new BusinessRuleError("That session is not open for sign-ups.", "SESSION_NOT_OPEN");
  }
  if (session.startAt <= new Date()) {
    throw new BusinessRuleError("That session has already started.", "SESSION_STARTED");
  }

  /**
   * A tutor cannot sit in their own class.
   *
   * Checked against the session's tutor rather than a role, because the same
   * person can hold a tutor profile and a family account — and letting them
   * enrol would let a tutor fill their own minimum and take the platform's
   * commission back out of their own pocket.
   */
  if (String(session.tutorUserId) === String(actor.id)) {
    throw new BusinessRuleError(
      "You cannot join your own group session.",
      "TUTOR_CANNOT_JOIN_OWN",
    );
  }

  const existing = await GroupEnrolment.findOne({
    sessionId: session._id,
    studentProfileId: student._id,
  }).lean();
  if (existing && existing.status !== GROUP_ENROLMENT_STATUS.CANCELLED) {
    throw new ConflictError("That student has already joined this session.");
  }

  // Claim a seat. Conditional on there still being one, so two people
  // clicking at the same instant cannot both take the last (§41 Phase 2).
  const claimed = await GroupSession.findOneAndUpdate(
    {
      _id: session._id,
      status: { $in: JOINABLE_GROUP_STATUSES },
      $expr: { $lt: ["$seatsTaken", "$maxParticipants"] },
    },
    { $inc: { seatsTaken: 1 } },
    { new: true },
  );

  if (!claimed) {
    return joinWaitlist(session, student, actor, settings);
  }

  try {
    const price = calculateLessonPrice({
      // The seat price is per learner; the hourly rate it implies is what the
      // ordinary pricing function needs.
      hourlyRateCents: Math.round((session.pricePerSeatCents * 60) / session.durationMinutes),
      durationMinutes: session.durationMinutes,
      commissionPercent: session.commissionPercent,
    });

    const booking = await Booking.create({
      reference: publicReference("APL"),
      purchaserId: actor.id,
      studentProfileId: student._id,
      tutorProfileId: session.tutorProfileId,
      tutorUserId: session.tutorUserId,
      courseId: session.courseId,
      courseName: session.courseName,
      courseCode: session.courseCode,
      subjectName: session.subjectName,
      mode: session.mode,
      meetingProvider: session.meetingProvider,
      location: session.location,
      startAt: session.startAt,
      endAt: session.endAt,
      durationMinutes: session.durationMinutes,
      timeZone: session.timeZone,
      status: BOOKING_STATUS.PENDING_PAYMENT,
      price,
      groupSessionId: session._id,
      studentNotes: input.studentNotes,
    });

    const enrolment = await GroupEnrolment.create({
      sessionId: session._id,
      purchaserId: actor.id,
      studentProfileId: student._id,
      bookingId: booking._id,
      status: GROUP_ENROLMENT_STATUS.PENDING_PAYMENT,
    });

    const payment = await createPaymentForBooking({
      bookings: [booking],
      purchaserId: actor.id,
      tutorUserId: session.tutorUserId,
    });

    await Promise.all([
      Booking.updateOne({ _id: booking._id }, { $set: { paymentId: payment.id } }),
      GroupEnrolment.updateOne({ _id: enrolment._id }, { $set: { paymentId: payment.id } }),
    ]);

    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.GROUP_ENROLMENT_CREATED,
      entityType: "GroupSession",
      entityId: session._id,
      metadata: { enrolment: String(enrolment._id), booking: booking.reference },
    });

    return {
      enrolment: toPlain(enrolment),
      booking: toPlain(booking),
      payment,
      seatsRemaining: claimed.maxParticipants - claimed.seatsTaken,
    };
  } catch (error) {
    // The seat was claimed but the enrolment could not be completed. Give it
    // back rather than leaving a phantom taking up a place.
    await GroupSession.updateOne(
      { _id: session._id, seatsTaken: { $gt: 0 } },
      { $inc: { seatsTaken: -1 } },
    );
    throw error;
  }
}

/** No seat left — take a place in the queue instead. */
async function joinWaitlist(session, student, actor, settings) {
  const cap = settings.groups?.maxWaitlist ?? 10;
  if (session.waitlistCount >= cap) {
    throw new ConflictError("This session is full and the waiting list is closed.");
  }

  const updated = await GroupSession.findOneAndUpdate(
    { _id: session._id, waitlistCount: { $lt: cap } },
    { $inc: { waitlistCount: 1 } },
    { new: true },
  );
  if (!updated) throw new ConflictError("This session is full and the waiting list is closed.");

  const enrolment = await GroupEnrolment.findOneAndUpdate(
    { sessionId: session._id, studentProfileId: student._id },
    {
      $set: {
        status: GROUP_ENROLMENT_STATUS.WAITLISTED,
        waitlistPosition: updated.waitlistCount,
        joinedAt: new Date(),
      },
      $setOnInsert: { purchaserId: actor.id },
      $unset: { cancelledAt: "", bookingId: "", paymentId: "" },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  return {
    enrolment: toPlain(enrolment),
    booking: null,
    payment: null,
    // Nothing is charged for a place in a queue; a seat is offered when one
    // frees up, and paid for then.
    waitlisted: true,
    waitlistPosition: updated.waitlistCount,
  };
}

/**
 * Confirm a session once the minimum is met.
 *
 * Called whenever a payment for a group booking settles. Idempotent, and the
 * meeting room is created once for the whole group rather than once per
 * learner — a group with six separate rooms is six people alone.
 */
export async function onGroupBookingConfirmed(booking) {
  if (!booking?.groupSessionId) return { changed: false };

  await GroupEnrolment.updateOne(
    { bookingId: booking._id },
    { $set: { status: GROUP_ENROLMENT_STATUS.CONFIRMED } },
  );

  const session = await GroupSession.findById(booking.groupSessionId);
  if (!session) return { changed: false };

  const confirmedSeats = await GroupEnrolment.countDocuments({
    sessionId: session._id,
    status: GROUP_ENROLMENT_STATUS.CONFIRMED,
  });

  if (
    session.status === GROUP_SESSION_STATUS.PUBLISHED &&
    confirmedSeats >= session.minParticipants
  ) {
    const claimed = await GroupSession.updateOne(
      { _id: session._id, status: GROUP_SESSION_STATUS.PUBLISHED },
      { $set: { status: GROUP_SESSION_STATUS.CONFIRMED, confirmedAt: new Date() } },
    );

    if (claimed.modifiedCount) {
      await ensureGroupMeeting(session._id);
      await notifyParticipants(session._id, {
        type: NOTIFICATION_TYPES.GROUP_SESSION_CONFIRMED,
        title: `${session.title} is going ahead`,
        body: `${formatDate(session.startAt, { weekday: "long", timeZone: session.timeZone })} at ${formatTime(session.startAt, session.timeZone)}.`,
      });
    }
  }

  return { changed: true };
}

/**
 * One room for the group, copied onto each learner's booking.
 *
 * Created once and shared, which is the whole point of a group session, and
 * stored on the session so a late joiner gets the same link.
 */
async function ensureGroupMeeting(sessionId) {
  const session = await GroupSession.findById(sessionId);
  if (!session || session.mode !== LESSON_MODES.ONLINE || session.meeting?.joinUrl) return;

  try {
    const provider = getMeetingProvider(session.meetingProvider);
    const meeting = await provider.createMeeting({
      topic: session.title,
      startAt: session.startAt,
      durationMinutes: session.durationMinutes,
      timeZone: session.timeZone,
      reference: session.reference,
    });

    session.meeting = { ...meeting, provider: meeting.provider ?? session.meetingProvider };
    await session.save();

    // Every learner sees the same link on their own booking.
    await Booking.updateMany(
      { groupSessionId: session._id },
      { $set: { meeting: session.meeting } },
    );
  } catch (error) {
    // A room that could not be created must not stop a session being
    // confirmed; the tutor can add one by hand (§27).
    console.error("[group] could not create the meeting room:", error.message);
  }
}

// --- Leaving ---------------------------------------------------------------

/**
 * Cancel one learner's place.
 *
 * The booking is cancelled through the ordinary cancellation path by the
 * caller; this releases the seat and offers it to whoever is waiting.
 */
export async function releaseGroupSeat(bookingId, { refundedCents = 0 } = {}) {
  const enrolment = await GroupEnrolment.findOne({ bookingId });
  if (!enrolment) return { released: false };
  if (!SEAT_HOLDING_ENROLMENT_STATUSES.includes(enrolment.status)) {
    return { released: false, reason: "NOT_HOLDING_A_SEAT" };
  }

  enrolment.status =
    refundedCents > 0 ? GROUP_ENROLMENT_STATUS.REFUNDED : GROUP_ENROLMENT_STATUS.CANCELLED;
  enrolment.cancelledAt = new Date();
  enrolment.refundedCents = refundedCents;
  await enrolment.save();

  const session = await GroupSession.findOneAndUpdate(
    { _id: enrolment.sessionId, seatsTaken: { $gt: 0 } },
    { $inc: { seatsTaken: -1 } },
    { new: true },
  );

  if (session) await offerSeatToWaitlist(session);

  await recordAudit({
    actor: { role: "SYSTEM" },
    action: AUDIT_ACTIONS.GROUP_ENROLMENT_CANCELLED,
    entityType: "GroupSession",
    entityId: enrolment.sessionId,
    metadata: { enrolment: String(enrolment._id), refundedCents },
  });

  return { released: true };
}

/**
 * Tell the next person in the queue that a seat is free.
 *
 * Deliberately an *offer*, not an automatic enrolment: nobody's card should
 * be charged because somebody else changed their mind. They join as normal,
 * and the seat goes to whoever takes it first.
 */
async function offerSeatToWaitlist(session) {
  if (session.seatsTaken >= session.maxParticipants) return;

  const next = await GroupEnrolment.findOne({
    sessionId: session._id,
    status: GROUP_ENROLMENT_STATUS.WAITLISTED,
  })
    .sort({ waitlistPosition: 1 })
    .lean();
  if (!next) return;

  await notify({
    userId: next.purchaserId,
    type: NOTIFICATION_TYPES.GROUP_SEAT_AVAILABLE,
    title: `A seat opened up in ${session.title}`,
    body: `${formatDate(session.startAt, { weekday: "long", timeZone: session.timeZone })} at ${formatTime(session.startAt, session.timeZone)}. Seats go to whoever takes them first.`,
    href: `/groups/${session._id}`,
    entityType: "GroupSession",
    entityId: session._id,
  });
}

/** A learner on the waiting list gives up their place. */
export async function leaveWaitlist(sessionId, { studentProfileId }, actor) {
  const enrolment = await GroupEnrolment.findOne({
    sessionId,
    studentProfileId,
    status: GROUP_ENROLMENT_STATUS.WAITLISTED,
  });
  if (!enrolment) throw new NotFoundError("You are not on that waiting list.");
  if (String(enrolment.purchaserId) !== String(actor.id)) {
    throw new AuthorizationError("That place is not yours.");
  }

  enrolment.status = GROUP_ENROLMENT_STATUS.CANCELLED;
  enrolment.cancelledAt = new Date();
  await enrolment.save();

  await GroupSession.updateOne(
    { _id: sessionId, waitlistCount: { $gt: 0 } },
    { $inc: { waitlistCount: -1 } },
  );

  return { left: true };
}

/**
 * Cancel the whole session.
 *
 * Everybody who paid is refunded in full, whatever the notice: a session that
 * does not run is not a late cancellation by the learner, and charging them
 * for it would be indefensible (§26).
 */
export async function cancelGroupSession(id, { reason }, actor) {
  const session = await GroupSession.findById(id);
  if (!session) throw new NotFoundError("That session no longer exists.");

  const isTutor = String(session.tutorUserId) === String(actor.id);
  if (!isTutor && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("That session is not yours to cancel.");
  }
  if ([GROUP_SESSION_STATUS.CANCELLED, GROUP_SESSION_STATUS.COMPLETED].includes(session.status)) {
    throw new ConflictError("That session is already over.");
  }

  // Claim first, so a double submit refunds once.
  const claimed = await GroupSession.updateOne(
    { _id: session._id, status: { $nin: [GROUP_SESSION_STATUS.CANCELLED, GROUP_SESSION_STATUS.COMPLETED] } },
    {
      $set: {
        status: GROUP_SESSION_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: actor.id,
        cancellationReason: reason,
      },
    },
  );
  if (!claimed.modifiedCount) throw new ConflictError("That session has already been cancelled.");

  const refunded = await refundEveryone(session, reason ?? "The session was cancelled.");

  await notifyParticipants(session._id, {
    type: NOTIFICATION_TYPES.GROUP_SESSION_CANCELLED,
    title: `${session.title} has been cancelled`,
    body: reason
      ? `${reason} You have been refunded in full.`
      : "You have been refunded in full.",
  });

  await refreshNextAvailable(session.tutorProfileId);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.GROUP_SESSION_CANCELLED,
    entityType: "GroupSession",
    entityId: session._id,
    metadata: { reference: session.reference, reason, ...refunded },
  });

  return { ...toPlain(await GroupSession.findById(session._id).lean()), ...refunded };
}

/** Cancel every booking in a session and send the money back. */
async function refundEveryone(session, reason) {
  const enrolments = await GroupEnrolment.find({
    sessionId: session._id,
    status: { $in: SEAT_HOLDING_ENROLMENT_STATUSES },
  });

  let refundedCents = 0;
  let cancelled = 0;

  for (const enrolment of enrolments) {
    const booking = enrolment.bookingId ? await Booking.findById(enrolment.bookingId) : null;
    if (booking && ![BOOKING_STATUS.CANCELLED_BY_TUTOR, BOOKING_STATUS.COMPLETED].includes(booking.status)) {
      booking.status = BOOKING_STATUS.CANCELLED_BY_TUTOR;
      booking.cancellation = {
        cancelledAt: new Date(),
        cancelledBy: session.tutorUserId,
        cancelledByRole: "TUTOR",
        reason,
        refundPercent: 100,
        refundCents: booking.price.totalCents,
        policyApplied: "TUTOR_CANCELLATION",
      };
      await booking.save();

      if (enrolment.paymentId) {
        const payment = await Payment.findById(enrolment.paymentId).lean();
        const refundable = (payment?.totalCents ?? 0) - (payment?.refundedCents ?? 0);
        if (refundable > 0) {
          await refundPayment(enrolment.paymentId, {
            amountCents: refundable,
            reason: "Group session cancelled",
          }).catch((error) => console.warn("[group] refund failed:", error.message));
          refundedCents += refundable;
        }
      }
      cancelled += 1;
    }

    enrolment.status = GROUP_ENROLMENT_STATUS.REFUNDED;
    enrolment.cancelledAt = new Date();
    enrolment.cancellationReason = reason;
    await enrolment.save();
  }

  await GroupSession.updateOne({ _id: session._id }, { $set: { seatsTaken: 0 } });

  return { cancelledBookings: cancelled, refundedCents };
}

// --- Attendance and completion ---------------------------------------------

/**
 * Record who turned up, and close the session.
 *
 * Attendance drives the booking's own outcome, so a learner who did not
 * attend is a no-show on their booking and the platform's existing no-show
 * policy decides what that costs — rather than a second, group-specific rule.
 */
export async function recordAttendance(id, { attendance }, actor) {
  const session = await ownedSession(id, actor, { allowAdmin: true });

  if (session.status === GROUP_SESSION_STATUS.CANCELLED) {
    throw new BusinessRuleError("That session was cancelled.", "SESSION_CANCELLED");
  }
  if (session.endAt > new Date()) {
    throw new BusinessRuleError("That session has not finished yet.", "SESSION_NOT_FINISHED");
  }

  const settings = await getSettings();
  const enrolments = await GroupEnrolment.find({
    sessionId: session._id,
    status: GROUP_ENROLMENT_STATUS.CONFIRMED,
  });
  const byId = new Map(enrolments.map((e) => [String(e._id), e]));

  let present = 0;
  let absent = 0;

  for (const row of attendance) {
    const enrolment = byId.get(row.enrolmentId);
    if (!enrolment) continue;

    enrolment.attendance = row.attended ? ATTENDANCE.PRESENT : ATTENDANCE.ABSENT;
    enrolment.attendanceRecordedAt = new Date();
    enrolment.attendanceRecordedBy = actor.id;
    await enrolment.save();

    const booking = enrolment.bookingId ? await Booking.findById(enrolment.bookingId) : null;
    if (!booking || booking.status !== BOOKING_STATUS.CONFIRMED) continue;

    if (row.attended) {
      booking.status = BOOKING_STATUS.COMPLETED;
      booking.completedAt = new Date();
      present += 1;
    } else {
      // The platform's existing no-show rule decides the money, not a
      // group-specific one (§26, §42).
      booking.status = BOOKING_STATUS.NO_SHOW_STUDENT;
      booking.cancellation = {
        cancelledAt: new Date(),
        cancelledBy: actor.id,
        cancelledByRole: "TUTOR",
        reason: "Did not attend the group session",
        refundPercent: settings.studentNoShowRefundPercent,
        refundCents: Math.round(
          (booking.price.totalCents * settings.studentNoShowRefundPercent) / 100,
        ),
        policyApplied: "STUDENT_NO_SHOW",
      };
      absent += 1;

      if (booking.cancellation.refundCents > 0 && booking.paymentId) {
        await refundPayment(booking.paymentId, {
          amountCents: booking.cancellation.refundCents,
          reason: "Group session no-show",
          issuedBy: actor.id,
        }).catch((error) => console.warn("[group] no-show refund failed:", error.message));
      }
    }
    await booking.save();
  }

  await GroupSession.updateOne(
    { _id: session._id, status: { $ne: GROUP_SESSION_STATUS.COMPLETED } },
    { $set: { status: GROUP_SESSION_STATUS.COMPLETED, completedAt: new Date() } },
  );

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.GROUP_ATTENDANCE_RECORDED,
    entityType: "GroupSession",
    entityId: session._id,
    metadata: { reference: session.reference, present, absent },
  });

  return { present, absent, recorded: present + absent };
}

// --- Scheduled work --------------------------------------------------------

/**
 * Cancel sessions that never filled, and nudge the ones still short.
 *
 * A session that has not reached its minimum by the deadline is cancelled and
 * everybody refunded in full — nobody pays for a lesson that does not happen,
 * and a tutor should not be obliged to teach six people's worth of material
 * to one.
 */
export async function settleUnderfilledSessions({ now = new Date(), limit = 100 } = {}) {
  const due = await GroupSession.find({
    status: GROUP_SESSION_STATUS.PUBLISHED,
    confirmBy: { $lt: now },
    startAt: { $gt: now },
  })
    .limit(limit)
    .lean();

  let cancelled = 0;
  let refundedCents = 0;

  for (const row of due) {
    const session = await GroupSession.findById(row._id);
    if (!session) continue;

    const confirmedSeats = await GroupEnrolment.countDocuments({
      sessionId: session._id,
      status: GROUP_ENROLMENT_STATUS.CONFIRMED,
    });

    if (confirmedSeats >= session.minParticipants) {
      // Enough people after all — confirm it rather than cancelling.
      await GroupSession.updateOne(
        { _id: session._id, status: GROUP_SESSION_STATUS.PUBLISHED },
        { $set: { status: GROUP_SESSION_STATUS.CONFIRMED, confirmedAt: now } },
      );
      await ensureGroupMeeting(session._id);
      continue;
    }

    const claimed = await GroupSession.updateOne(
      { _id: session._id, status: GROUP_SESSION_STATUS.PUBLISHED },
      {
        $set: {
          status: GROUP_SESSION_STATUS.CANCELLED,
          cancelledAt: now,
          cancellationReason: "Not enough people signed up.",
        },
      },
    );
    if (!claimed.modifiedCount) continue;

    const result = await refundEveryone(session, "Not enough people signed up.");
    refundedCents += result.refundedCents;
    cancelled += 1;

    await notifyParticipants(session._id, {
      type: NOTIFICATION_TYPES.GROUP_SESSION_CANCELLED,
      title: `${session.title} didn't go ahead`,
      body: "Not enough people signed up, so it has been cancelled and you have been refunded in full.",
    });

    await notify({
      userId: session.tutorUserId,
      type: NOTIFICATION_TYPES.GROUP_SESSION_CANCELLED,
      title: `${session.title} didn't fill up`,
      body: `It needed ${session.minParticipants} and had ${confirmedSeats}, so it has been cancelled and everybody refunded.`,
      href: "/tutor/groups",
      entityType: "GroupSession",
      entityId: session._id,
    });

    await refreshNextAvailable(session.tutorProfileId);
  }

  if (cancelled) {
    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.GROUP_SESSION_CANCELLED,
      entityType: "GroupSession",
      metadata: { cancelled, refundedCents, reason: "under-subscribed" },
    });
  }

  return { examined: due.length, cancelled, refundedCents };
}

// --- Reads -----------------------------------------------------------------

/** Sessions a family can browse and join. */
export async function listOpenSessions({ courseId, tutorProfileId, gradeLevel, page = 1, pageSize } = {}) {
  const settings = await getSettings();
  if (settings.groups?.enabled === false) {
    return { items: [], total: 0, page, pageSize: pageSize ?? PAGE_SIZES.tutorSearch };
  }

  const size = pageSize ?? PAGE_SIZES.tutorSearch;
  const query = {
    status: { $in: JOINABLE_GROUP_STATUSES },
    startAt: { $gt: new Date() },
  };
  if (courseId) query.courseId = courseId;
  if (tutorProfileId) query.tutorProfileId = tutorProfileId;
  if (gradeLevel) query.gradeLevel = gradeLevel;

  const [items, total] = await Promise.all([
    GroupSession.find(query)
      .sort({ startAt: 1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate({ path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } })
      .lean(),
    GroupSession.countDocuments(query),
  ]);

  return { items: toPlain(items).map(publicSession), total, page, pageSize: size };
}

/**
 * One session.
 *
 * The roster is only ever shown to the tutor and to administrators: who else
 * is in a class is not a family's business, and a minor's name least of all
 * (§35).
 */
export async function getGroupSession(id, actor) {
  const session = await GroupSession.findById(id)
    .populate({ path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } })
    .lean();
  if (!session) throw new NotFoundError("That session no longer exists.");

  const isTutor = actor && String(session.tutorUserId) === String(actor.id);
  const isAdmin = actor?.role === ROLES.ADMIN;

  const myEnrolments = actor
    ? await GroupEnrolment.find({ sessionId: session._id, purchaserId: actor.id })
        .populate("studentProfileId", "firstName gradeName")
        .lean()
    : [];

  const roster =
    isTutor || isAdmin
      ? await GroupEnrolment.find({
          sessionId: session._id,
          status: { $in: [...SEAT_HOLDING_ENROLMENT_STATUSES, GROUP_ENROLMENT_STATUS.WAITLISTED] },
        })
          .populate("studentProfileId", "firstName lastName gradeName isMinor shareFullNameWithTutor")
          .lean()
      : [];

  return {
    session: publicSession(toPlain(session)),
    // The meeting link belongs to the people actually attending (§27).
    meeting: isTutor || myEnrolments.some((e) => e.status === GROUP_ENROLMENT_STATUS.CONFIRMED)
      ? (session.meeting ?? null)
      : null,
    myEnrolments: toPlain(myEnrolments),
    roster: toPlain(roster).map((entry) => ({
      id: entry.id,
      status: entry.status,
      attendance: entry.attendance ?? null,
      waitlistPosition: entry.waitlistPosition ?? null,
      studentName: learnerDisplayName(entry.studentProfileId),
      gradeName: entry.studentProfileId?.gradeName ?? null,
    })),
    canManage: Boolean(isTutor || isAdmin),
  };
}

/** A tutor's own sessions. */
export async function listSessionsForTutor(actor, { status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const profile = await TutorProfile.findOne({ userId: actor.id }).select("_id").lean();
  if (!profile) return { items: [], total: 0, page, pageSize: size };

  const query = { tutorProfileId: profile._id };
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    GroupSession.find(query)
      .sort({ startAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean(),
    GroupSession.countDocuments(query),
  ]);

  return { items: toPlain(items).map(publicSession), total, page, pageSize: size };
}

/** The sessions a family has joined. */
export async function listEnrolmentsForOwner(actor, { page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;

  const [items, total] = await Promise.all([
    GroupEnrolment.find({ purchaserId: actor.id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName gradeName")
      .populate({
        path: "sessionId",
        populate: { path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } },
      })
      .lean(),
    GroupEnrolment.countDocuments({ purchaserId: actor.id }),
  ]);

  return {
    items: toPlain(items).filter((e) => e.sessionId),
    total,
    page,
    pageSize: size,
  };
}

/** Every session, for admin moderation. */
export async function listAllSessions({ status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    GroupSession.find(query)
      .sort({ startAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("tutorUserId", "firstName lastName email")
      .lean(),
    GroupSession.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

// --- Internals -------------------------------------------------------------

/** The shape everybody sees. Never the tutor's private notes or an address. */
function publicSession(session) {
  const profile = session.tutorProfileId;
  const account = profile?.userId;

  return {
    ...session,
    tutorNotes: undefined,
    location: session.location
      ? { ...session.location, addressLine: undefined }
      : undefined,
    seatsRemaining: Math.max(0, session.maxParticipants - session.seatsTaken),
    tutor:
      profile && typeof profile === "object"
        ? {
            id: profile.id ?? String(profile._id),
            slug: profile.slug,
            displayName: account ? `${account.firstName} ${account.lastName?.charAt(0) ?? ""}.` : "Tutor",
            avatarUrl: account?.avatarUrl ?? null,
          }
        : undefined,
    tutorProfileId: profile?.id ?? profile?._id ?? session.tutorProfileId,
  };
}

function assertCapacity(input, settings) {
  const min = settings.groups?.minParticipants ?? 2;
  const max = settings.groups?.maxParticipants ?? 12;

  if (input.minParticipants < min) {
    throw new BusinessRuleError(
      `A group session needs at least ${min} people.`,
      "MIN_PARTICIPANTS_TOO_LOW",
    );
  }
  if (input.maxParticipants > max) {
    throw new BusinessRuleError(
      `A group session can hold at most ${max} people.`,
      "MAX_PARTICIPANTS_TOO_HIGH",
    );
  }
  if (input.minParticipants > input.maxParticipants) {
    throw new BusinessRuleError(
      "The minimum cannot be larger than the maximum.",
      "CAPACITY_INVERTED",
    );
  }
}

async function ownedSession(id, actor, { allowAdmin = false } = {}) {
  const session = await GroupSession.findById(id);
  if (!session) throw new NotFoundError("That session no longer exists.");

  const isTutor = String(session.tutorUserId) === String(actor.id);
  if (!isTutor && !(allowAdmin && actor.role === ROLES.ADMIN)) {
    // Checked against the loaded record (§42).
    throw new AuthorizationError("That session is not yours.");
  }
  return session;
}

async function notifyParticipants(sessionId, payload) {
  const enrolments = await GroupEnrolment.find({
    sessionId,
    status: { $in: [...SEAT_HOLDING_ENROLMENT_STATUSES, GROUP_ENROLMENT_STATUS.REFUNDED] },
  })
    .select("purchaserId")
    .lean();

  const recipients = [...new Set(enrolments.map((e) => String(e.purchaserId)))];
  if (!recipients.length) return;

  await notifyMany(recipients, {
    ...payload,
    href: `/groups/${sessionId}`,
    entityType: "GroupSession",
    entityId: sessionId,
  });
}
