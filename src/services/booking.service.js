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
  BOOKING_REMINDERS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
  FEATURES,
  PAYMENT_STATUS,
} from "@/constants";
import {
  NotFoundError,
  BusinessRuleError,
  AuthorizationError,
  ConflictError,
} from "@/lib/api/errors";
import { requireParticipant, requireVerifiedEmail } from "@/lib/auth/assert";
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
  shouldReleaseHold,
  holdMinutes,
} from "@/lib/booking/policy";
import { isSlotBookable } from "@/lib/booking/slots";
import { getSettings } from "./settings.service";
import { getMeetingProvider } from "./external/meeting-provider";
import { brandedEmailTemplates } from "./external/email-provider";
import {
  createPaymentForBooking,
  refundPayment,
  providerPaymentStatus,
  markPaymentPaid,
} from "./payment.service";
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
 * Bookings start in PENDING_PAYMENT, which *does* hold the slot — that is the
 * point of it — and are CONFIRMED once the payment service reports success.
 * An abandoned checkout is released by `expireStaleBookings()` below, which
 * the `booking-expiry` job runs; the hold window itself is `CHECKOUT_HOLD`.
 */
export async function createBooking(input, actor) {
  // Enforced here rather than only in the route pipeline, so every path into
  // booking — API, server action, admin tool — obeys the same rule (§9).
  requireVerifiedEmail(actor, "Confirm your email address before booking a lesson.");

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

  // The meeting platform is the learner's choice, but only from the ones this
  // tutor actually teaches on. Checked here rather than trusted from the form,
  // because this value now decides which provider a real room is created on
  // (§27, §42).
  if (input.mode === LESSON_MODES.ONLINE) {
    const offered = tutor.onlineMeetingProviders?.length
      ? tutor.onlineMeetingProviders
      : [MEETING_PROVIDERS.ZOOM];
    if (!offered.includes(input.meetingProvider)) {
      throw new BusinessRuleError(
        "This tutor does not teach on that meeting platform.",
        "MEETING_PROVIDER_UNAVAILABLE",
      );
    }
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
      // Intent, recorded now and acted on later. The room itself is created
      // after payment, by a webhook that has no access to this request (§27).
      meetingProvider: input.mode === LESSON_MODES.ONLINE ? input.meetingProvider : undefined,
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

  // The validation above is a read followed by a write, so two requests for
  // the same slot can both pass it. This closes that window before any money
  // is taken (§18, §42).
  await settleSlotRace(created, tutor);

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

/**
 * Find any stored booking that overlaps one of these lessons (§18).
 *
 * The windows are tested one occurrence at a time, never as a single envelope
 * — a weekly series legitimately leaves the days in between free, and an
 * envelope test would refuse a booking sitting in one of those gaps.
 */
function overlapQuery(lessons, tutorProfileId, excludeIds = []) {
  return {
    tutorProfileId,
    ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
    status: { $in: BLOCKING_BOOKING_STATUSES },
    $or: lessons.map((l) => ({ startAt: { $lt: l.endAt }, endAt: { $gt: l.startAt } })),
  };
}

/**
 * Decide a double-booking race, without a transaction.
 *
 * MongoDB cannot express "no overlapping time range" as a unique index, and
 * the platform is expected to run against a standalone server as readily as a
 * replica set, so the guarantee is made by writing first and reading back:
 * whichever request inserts second is certain to see the first. When both see
 * each other, the same tie-break runs on both sides — the lowest booking id
 * wins — so exactly one survives and the other is withdrawn before a payment
 * exists for it. Reschedules settle against the same rule.
 */
async function settleSlotRace(created, tutor) {
  const ids = created.map((b) => b._id);
  const conflicts = await Booking.find(overlapQuery(created, tutor._id, ids))
    .select("_id startAt")
    .lean();
  if (!conflicts.length) return;

  const ourEarliest = ids.map(String).sort()[0];
  const lost = conflicts.filter((c) => String(c._id) < ourEarliest);
  if (!lost.length) return;

  // We were second. Withdraw cleanly — nothing has been charged yet.
  await Booking.deleteMany({ _id: { $in: ids } });
  throw new ConflictError(
    created.length > 1
      ? "Someone booked one of those times while you were checking out. Please pick another slot."
      : `${formatDate(lost[0].startAt, { weekday: "short" })} at ${formatTime(lost[0].startAt, tutor.timeZone)} was booked moments ago. Please pick another time.`,
  );
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
  // EXPIRED is included for one narrow case: a payment that settles in the
  // moments after the sweep released its hold — an async payment method, or a
  // webhook that arrived late. Reviving is conditional on the slot still
  // being free, checked per booking below, so a lesson is never resurrected
  // on top of somebody else's.
  const candidates = await Booking.find({
    paymentId,
    status: { $in: [BOOKING_STATUS.PENDING_PAYMENT, BOOKING_STATUS.EXPIRED] },
  });
  if (!candidates.length) return { confirmed: 0 };

  const confirmed = [];
  const unconfirmable = [];

  for (const booking of candidates) {
    if (booking.status === BOOKING_STATUS.EXPIRED && !(await slotStillFree(booking))) {
      unconfirmable.push(booking);
      continue;
    }

    booking.status = BOOKING_STATUS.CONFIRMED;
    booking.confirmedAt = new Date();
    booking.expiredAt = undefined;

    if (booking.mode === LESSON_MODES.ONLINE) {
      // The stored choice wins; the argument is only a fallback for callers
      // that confirm a booking made before the field existed.
      booking.meeting = await createMeetingFor(booking, booking.meetingProvider ?? meetingProvider);
    }

    await booking.save();
    confirmed.push(booking);
  }

  if (unconfirmable.length) {
    // Money was taken for a slot that is gone. Nothing here can put that
    // right silently, so it is made loud: an administrator refunds it.
    console.error(
      `[booking] payment ${paymentId} settled after ${unconfirmable.length} hold(s) lapsed and the slot(s) were retaken.`,
    );
    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.BOOKING_EXPIRED,
      entityType: "Payment",
      entityId: paymentId,
      metadata: {
        reason: "paid after hold lapsed; slot no longer available",
        bookings: unconfirmable.map((b) => b.reference),
        needsRefund: true,
      },
    });
  }

  if (!confirmed.length) return { confirmed: 0, unconfirmable: unconfirmable.length };

  await Promise.all([
    refreshNextAvailable(confirmed[0].tutorProfileId),
    notifyBookingConfirmed(confirmed),
  ]);

  return {
    confirmed: confirmed.length,
    unconfirmable: unconfirmable.length,
    bookings: toPlain(confirmed),
  };
}

// --- Releasing an abandoned hold (§19, §20) --------------------------------

/**
 * Release the slots held by bookings whose checkout was never completed.
 *
 * This is what stops an abandoned — or deliberately abandoned — checkout from
 * erasing a tutor's calendar. Without it, PENDING_PAYMENT is a hold that
 * nothing ever lets go of, and any signed-in learner can take a tutor's whole
 * week off the market for free.
 *
 * The contract, because the `booking-expiry` job may run at any time, twice
 * at once, or after a long gap:
 *
 *   **Idempotent.** Every write is a conditional claim on a status the
 *   booking must still be in. A second run finds nothing left to claim.
 *   **Overlap-safe.** Two concurrent runs race on the same claims and exactly
 *   one wins each; the loser sees `modifiedCount === 0` and moves on.
 *   **Conservative.** Whether a hold may be released at all is decided by
 *   `shouldReleaseHold()` in lib/booking/policy — the one place that rule
 *   lives — and a settled payment is never touched, whatever its age.
 *
 * It also collects bookings created before this mechanism existed: they are
 * old PENDING_PAYMENT rows with a lapsed hold, which is exactly what this
 * query selects, so they are swept on the first run rather than migrated.
 *
 * @param {object}  [options]
 * @param {Date}    [options.now]    Injected by tests so "stale" is deterministic.
 * @param {number}  [options.limit]  Ceiling on one sweep, so a backlog is
 *                                   worked through over several runs instead
 *                                   of in one very long request.
 * @param {Function} [options.readProviderStatus]  How the payment provider is
 *                                   asked what really happened. Injected by
 *                                   tests, which must be able to make the
 *                                   provider say "paid" or fall over without
 *                                   an account at Stripe.
 */
export async function expireStaleBookings({
  now = new Date(),
  limit = 500,
  readProviderStatus = providerPaymentStatus,
} = {}) {
  const settings = await getSettings();

  // Nothing created inside the shortest possible hold can be stale, so the
  // query never even looks at the bookings currently being paid for.
  const earliestPossible = new Date(now.getTime() - holdMinutes(settings) * 60_000);

  const candidates = await Booking.find({
    status: BOOKING_STATUS.PENDING_PAYMENT,
    createdAt: { $lte: earliestPossible },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  if (!candidates.length) return { examined: 0, expired: 0, held: 0, payments: 0 };

  // One read per payment, not per booking: a recurring series shares one.
  const paymentIds = [...new Set(candidates.filter((b) => b.paymentId).map((b) => String(b.paymentId)))];
  const payments = paymentIds.length
    ? await Payment.find({ _id: { $in: paymentIds } })
        .select("_id status checkoutExpiresAt providerCheckoutUrl provider providerCheckoutId providerPaymentIntentId totalCents")
        .lean()
    : [];
  const paymentById = new Map(payments.map((p) => [String(p._id), p]));

  // Before releasing anything, ask the provider what actually happened to
  // each unpaid payment. A webhook can be lost, and the only outcome worse
  // than a slot held too long is a paid lesson deleted because the event
  // never arrived. `unreconciled` holds the payments we could not get an
  // answer for; their bookings are kept for the next sweep rather than
  // released on a guess.
  const unreconciled = await reconcileUnpaidPayments(payments, paymentById, readProviderStatus);

  let expired = 0;
  let held = 0;
  const tutorProfileIds = new Set();
  const settledPayments = new Set();

  for (const booking of candidates) {
    const payment = booking.paymentId ? paymentById.get(String(booking.paymentId)) : null;

    // The provider could not be asked, so we do not know whether this was
    // paid. Keep the hold and try again on the next run.
    if (payment && unreconciled.has(String(payment._id))) {
      held += 1;
      continue;
    }

    const verdict = shouldReleaseHold({ booking, payment, settings, now });
    if (!verdict.expire) {
      held += 1;
      continue;
    }

    const released = await releaseBooking(booking, { now, reason: verdict.reason });
    if (!released) {
      held += 1;
      continue;
    }

    expired += 1;
    tutorProfileIds.add(String(booking.tutorProfileId));
    if (payment) settledPayments.add(String(payment._id));
  }

  // A payment whose lessons are all gone must stop being payable, or the
  // checkout page would happily take money for nothing.
  let paymentsClosed = 0;
  for (const paymentId of settledPayments) {
    if (await closeAbandonedPayment(paymentId)) paymentsClosed += 1;
  }

  await Promise.all([...tutorProfileIds].map((id) => refreshNextAvailable(id)));

  return { examined: candidates.length, expired, held, payments: paymentsClosed };
}

/**
 * Catch up on payments whose confirming webhook never arrived (§20, §38).
 *
 * Called by the sweep above, on exactly the payments it is about to release
 * lessons for. For each one the provider's own API is asked what happened —
 * not a browser, not a redirect, the provider — and the answer is applied:
 *
 *   PAID    settle it and confirm its bookings, the same way the webhook
 *           would have. `markPaymentPaid` is a no-op if a webhook has since
 *           landed, so a race between the two settles once.
 *   FAILED  leave it; the sweep releases the slot as it already would.
 *   unknown keep the hold. We are about to do something irreversible and we
 *           could not establish that the purchaser was not charged.
 *
 * The development provider has no remote state and is never asked;
 * `providerPaymentStatus()` returns null for it.
 *
 * @returns {Promise<Set<string>>} ids of payments whose state could not be
 *   established, whose bookings must therefore be left alone.
 */
async function reconcileUnpaidPayments(payments, paymentById, readProviderStatus) {
  const unreconciled = new Set();

  for (const payment of payments) {
    if (payment.status !== PAYMENT_STATUS.REQUIRES_PAYMENT && payment.status !== PAYMENT_STATUS.PROCESSING) {
      continue;
    }

    let remote;
    try {
      remote = await readProviderStatus(payment);
    } catch (error) {
      // A provider outage must not turn into deleted lessons.
      console.warn(
        `[booking-expiry] could not reconcile payment ${payment._id} with the provider: ${error.message}`,
      );
      unreconciled.add(String(payment._id));
      continue;
    }

    // Nothing to ask (development provider, or no session was ever opened).
    if (!remote) continue;

    if (remote.status !== "PAID") continue;

    try {
      const { changed } = await markPaymentPaid(payment._id, {
        paidAt: new Date(),
        paymentIntentId: remote.paymentIntentId,
        amountCents: remote.amountCents,
      });
      if (changed) {
        await confirmBookings(payment._id);
        await recordAudit({
          actor: { role: "SYSTEM" },
          action: AUDIT_ACTIONS.PAYMENT_SETTLED,
          entityType: "Payment",
          entityId: payment._id,
          metadata: { source: "reconciliation", amountCents: remote.amountCents },
        });
      }
      // Either way the money is in: the sweep must not touch these lessons.
      paymentById.set(String(payment._id), { ...payment, status: PAYMENT_STATUS.PAID });
    } catch (error) {
      // An amount mismatch lands here, and is exactly the case where doing
      // nothing automatically is right. It is audited by `markPaymentPaid`'s
      // own error and the hold is kept for a human to look at.
      console.error(
        `[booking-expiry] payment ${payment._id} is paid at the provider but could not be settled: ${error.message}`,
      );
      unreconciled.add(String(payment._id));
    }
  }

  return unreconciled;
}

/**
 * Move one booking to EXPIRED, if it is still there to be moved.
 *
 * The status filter is the whole guarantee. Between the sweep's read and this
 * write the booking may have been confirmed by a webhook or cancelled by its
 * purchaser; in either case the update matches nothing and the caller is told
 * so rather than overwriting a decision someone else made.
 *
 * @returns {Promise<boolean>} whether this call is the one that expired it.
 */
async function releaseBooking(booking, { now = new Date(), reason } = {}) {
  const claim = await Booking.updateOne(
    { _id: booking._id, status: BOOKING_STATUS.PENDING_PAYMENT },
    { $set: { status: BOOKING_STATUS.EXPIRED, expiredAt: now } },
  );
  if (claim.modifiedCount !== 1) return false;

  await recordAudit({
    actor: { role: "SYSTEM" },
    action: AUDIT_ACTIONS.BOOKING_EXPIRED,
    entityType: "Booking",
    entityId: booking._id,
    metadata: {
      reference: booking.reference,
      reason,
      startAt: new Date(booking.startAt).toISOString(),
      tutorProfileId: String(booking.tutorProfileId),
    },
  });

  // Told once per booking, and only to the purchaser: the tutor never saw an
  // unpaid hold as a confirmed lesson, so nothing changed on their side.
  await notifyHoldReleased(booking).catch((error) => {
    console.error(`[booking] expiry notice failed for ${booking.reference}:`, error.message);
  });

  return true;
}

/**
 * Stop an abandoned payment being payable, once every booking it covers has
 * been released. A payment still carrying a live booking is left alone.
 */
async function closeAbandonedPayment(paymentId) {
  const stillHeld = await Booking.exists({
    paymentId,
    status: { $in: BLOCKING_BOOKING_STATUSES },
  });
  if (stillHeld) return false;

  const claim = await Payment.updateOne(
    {
      _id: paymentId,
      status: { $in: [PAYMENT_STATUS.REQUIRES_PAYMENT, PAYMENT_STATUS.PROCESSING] },
    },
    {
      $set: { status: PAYMENT_STATUS.FAILED, failureReason: "Checkout was not completed in time." },
      $unset: { providerCheckoutUrl: "", checkoutExpiresAt: "" },
    },
  );
  return claim.modifiedCount === 1;
}

async function notifyHoldReleased(booking) {
  await notify({
    userId: booking.purchaserId,
    type: NOTIFICATION_TYPES.BOOKING_EXPIRED,
    title: "Your held lesson time has been released",
    body: `Payment for ${booking.courseName} on ${formatDate(booking.startAt, { weekday: "short", timeZone: booking.timeZone })} at ${formatTime(booking.startAt, booking.timeZone)} was not completed, so the time is available to book again.`,
    href: `/tutors`,
    entityType: "Booking",
    entityId: booking._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP],
  });
}

/**
 * Release the slots behind one payment immediately, on a *verified* provider
 * failure (§20, §38).
 *
 * Called only by `webhook.service`, after the event's signature has been
 * checked and the payment resolved from it — never from anything a browser
 * sent. Whether a given failure should release at all is `failureReleasesHold()`
 * in lib/booking/policy; this function does not second-guess it, it only
 * enforces that a settled payment's bookings are untouchable.
 *
 * @returns {Promise<{ expired: number }>}
 */
export async function releaseBookingsForFailedPayment(paymentId, { reason, now = new Date() } = {}) {
  const payment = await Payment.findById(paymentId).select("_id status").lean();
  if (!payment) return { expired: 0 };

  // Belt and braces over the caller's own check: money in hand outranks any
  // failure event, which routinely arrive out of order.
  if (
    payment.status === PAYMENT_STATUS.PAID ||
    payment.status === PAYMENT_STATUS.PARTIALLY_REFUNDED ||
    payment.status === PAYMENT_STATUS.REFUNDED
  ) {
    return { expired: 0 };
  }

  const held = await Booking.find({
    paymentId: payment._id,
    status: BOOKING_STATUS.PENDING_PAYMENT,
  }).lean();
  if (!held.length) return { expired: 0 };

  let expired = 0;
  const tutorProfileIds = new Set();

  for (const booking of held) {
    if (await releaseBooking(booking, { now, reason: reason ?? "payment failed" })) {
      expired += 1;
      tutorProfileIds.add(String(booking.tutorProfileId));
    }
  }

  await Promise.all([...tutorProfileIds].map((id) => refreshNextAvailable(id)));

  return { expired };
}

/** Is this lesson's window still clear of every booking that blocks a slot? */
async function slotStillFree(booking) {
  const clash = await Booking.exists(
    overlapQuery([{ startAt: booking.startAt, endAt: booking.endAt }], booking.tutorProfileId, [
      booking._id,
    ]),
  );
  return !clash;
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
  // The platform the learner chose. It reached here from the Booking record,
  // which was written server-side at booking time — never from a request
  // body at confirmation time (§42).
  const provider = requestedProvider ?? booking.meetingProvider ?? MEETING_PROVIDERS.ZOOM;
  try {
    // One adapter per platform: Zoom, Google Meet or Microsoft Teams,
    // falling back to the development provider where this deployment has no
    // credentials for the one that was chosen.
    return await getMeetingProvider(provider).createMeeting({
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

/**
 * Tear a room down so a cancelled lesson's link stops working.
 *
 * Torn down through the adapter for the platform the room was *actually*
 * created on — `meeting.provider`, not the booking's requested one, which can
 * differ when the chosen platform was unconfigured and the room came from the
 * development provider.
 */
async function releaseMeetingFor(booking) {
  if (!booking.meeting?.meetingId) return;
  try {
    await getMeetingProvider(booking.meeting.provider).deleteMeeting({
      meetingId: booking.meeting.meetingId,
    });
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
      // An expired hold belongs here too: from the learner's point of view a
      // lesson that was cancelled and one whose payment lapsed are the same
      // outcome, and leaving EXPIRED out of every scope would hide it.
      query.status = { $in: [...CANCELLED_STATUSES, BOOKING_STATUS.EXPIRED] };
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

/**
 * The actor's role *in this booking*, derived from the stored record (§8).
 *
 * Fails closed: somebody who is neither participant nor administrator gets
 * `null`, never a participant role. Defaulting a stranger to "STUDENT" would
 * hand them every right the person who paid has.
 */
function actorRoleFor(booking, actor) {
  if (actor.role === ROLES.ADMIN) return "ADMIN";
  if (String(booking.tutorUserId) === String(actor.id)) return "TUTOR";
  if (String(booking.purchaserId) === String(actor.id)) return "STUDENT";
  return null;
}

/**
 * Resolve the actor's role and refuse anyone who is not a party to the
 * booking. Every mutating booking operation starts here, so participation is
 * asserted against the loaded record before any state is touched (§42).
 */
function requireBookingRole(booking, actor, message) {
  requireParticipant(actor, [booking.purchaserId, booking.tutorUserId], message);
  const role = actorRoleFor(booking, actor);
  if (!role) throw new AuthorizationError(message ?? "You do not have access to this lesson.");
  return role;
}

// --- Cancellation (§26) ----------------------------------------------------

export async function cancelBooking(id, { reason, cancelSeries }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const role = requireBookingRole(booking, actor, "You can only cancel your own lessons.");
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

/** A no-show can only be recorded against a lesson whose outcome is still open. */
const NO_SHOW_REPORTABLE_STATUSES = [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED];

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

/**
 * Reporting that the other party did not attend (§26).
 *
 * This reverses money — it can refund the learner in full and strip the
 * lesson out of the tutor's payout eligibility — so it is authorized against
 * the stored participants, and only ever against the *opposite* party: a
 * learner reports the tutor, a tutor reports the learner. An administrator
 * may record either, which is the documented adjudication path.
 */
export async function reportNoShow(id, { party, note }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const role = requireBookingRole(
    booking,
    actor,
    "You can only report a no-show on your own lesson.",
  );

  if (party === "TUTOR" && role !== "STUDENT" && role !== "ADMIN") {
    throw new AuthorizationError("Only the student can report a tutor no-show.");
  }
  if (party === "STUDENT" && role !== "TUTOR" && role !== "ADMIN") {
    throw new AuthorizationError("Only the tutor can report a student no-show.");
  }
  if (new Date(booking.endAt) > new Date()) {
    throw new BusinessRuleError("You can report a no-show once the lesson has finished.");
  }
  // A lesson that is already cancelled, already reported or under dispute has
  // had its outcome decided; re-reporting it would refund it a second time.
  if (!NO_SHOW_REPORTABLE_STATUSES.includes(booking.status)) {
    throw new BusinessRuleError(
      "This lesson is no longer open to a no-show report.",
      "NOT_REPORTABLE",
    );
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

  // A no-show reverses a settled lesson, so who asked for it is recorded.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.BOOKING_NO_SHOW_REPORTED,
    entityType: "Booking",
    entityId: booking._id,
    metadata: { party, role, refundCents: refund.refundCents, note },
  });

  return toPlain(booking);
}

// --- Reschedule ------------------------------------------------------------

export async function rescheduleBooking(id, { startAt, durationMinutes, reason }, actor) {
  const booking = await Booking.findById(id);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const role = requireBookingRole(booking, actor, "You can only reschedule your own lessons.");

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

  // Everything needed to put the lesson back if it loses the slot below.
  // Captured before any of it is touched, the price included.
  const previousLabel = `${formatDate(booking.startAt, { weekday: "long", timeZone: booking.timeZone })} at ${formatTime(booking.startAt, booking.timeZone)}`;
  const previous = {
    startAt: booking.startAt,
    endAt: booking.endAt,
    durationMinutes: booking.durationMinutes,
    price: booking.price.toObject ? booking.price.toObject() : booking.price,
  };

  // The price is re-derived if the length changed — never carried over blindly.
  if (duration !== booking.durationMinutes) {
    booking.price = calculateLessonPrice({
      hourlyRateCents: booking.price.hourlyRateCents,
      durationMinutes: duration,
      commissionPercent: booking.price.commissionPercent,
    });
  }

  booking.startAt = new Date(startAt);
  booking.endAt = addMinutes(new Date(startAt), duration);
  booking.durationMinutes = duration;

  // Claim the new slot before anything irreversible happens. Same rule as
  // booking creation: write, read back, lowest id wins the contested slot.
  await booking.save();
  const raced = await Booking.findOne(
    overlapQuery([booking], booking.tutorProfileId, [booking._id]),
  )
    .select("_id startAt")
    .lean();

  if (raced && String(raced._id) < String(booking._id)) {
    Object.assign(booking, previous);
    await booking.save();
    throw new ConflictError(
      `${formatDate(raced.startAt, { weekday: "short" })} at ${formatTime(raced.startAt, booking.timeZone)} was booked moments ago. Please pick another time.`,
    );
  }

  // Move the existing room rather than issuing a new link, so a join link
  // already in someone's calendar keeps working (§27).
  if (booking.mode === LESSON_MODES.ONLINE) {
    if (booking.meeting?.meetingId) {
      try {
        await getMeetingProvider(booking.meeting.provider).updateMeeting({
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
    await booking.save();
  }

  await refreshNextAvailable(booking.tutorProfileId);

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.BOOKING_RESCHEDULED,
    entityType: "Booking",
    entityId: booking._id,
    metadata: { role, from: previous.startAt, to: booking.startAt, reason },
  });

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

// --- Reminders (§28) -------------------------------------------------------

/**
 * Send the lesson reminders that have fallen due.
 *
 * Run by the scheduler, and safe to run as often as it likes: each reminder
 * is *claimed* with a conditional update before anything is sent, so a job
 * that runs twice — or twice concurrently — cannot produce two reminders for
 * the same lesson. `Booking.remindersSent` is the claim ledger.
 *
 * @param {object}  [options]
 * @param {Date}    [options.now]    Injected in tests for determinism.
 * @param {number}  [options.limit]  Cap on bookings examined per run.
 */
export async function sendBookingReminders({ now = new Date(), limit = 500 } = {}) {
  const widest = Math.max(...BOOKING_REMINDERS.map((r) => r.minutesBefore));

  const due = await Booking.find({
    status: BOOKING_STATUS.CONFIRMED,
    startAt: { $gt: now, $lte: addMinutes(now, widest) },
  })
    .sort({ startAt: 1 })
    .limit(limit)
    .lean();

  let sent = 0;
  const skipped = [];

  for (const booking of due) {
    for (const reminder of BOOKING_REMINDERS) {
      const dueAt = addMinutes(new Date(booking.startAt), -reminder.minutesBefore);
      if (now < dueAt) continue;

      // Claim first. The filter is the whole guarantee: whichever run wins
      // the update is the only one that goes on to notify.
      const claim = await Booking.updateOne(
        {
          _id: booking._id,
          status: BOOKING_STATUS.CONFIRMED,
          remindersSent: { $ne: reminder.key },
        },
        { $addToSet: { remindersSent: reminder.key } },
      );
      if (claim.modifiedCount !== 1) {
        skipped.push({ bookingId: String(booking._id), reminder: reminder.key });
        continue;
      }

      await notifyBookingReminder(booking, reminder);
      sent += 1;
    }
  }

  return { examined: due.length, sent, alreadySent: skipped.length };
}

async function notifyBookingReminder(booking, reminder) {
  const [purchaser, tutorUser] = await Promise.all([
    User.findById(booking.purchaserId).select("firstName").lean(),
    User.findById(booking.tutorUserId).select("firstName lastName").lean(),
  ]);

  const tutorName = publicName(tutorUser?.firstName ?? "", tutorUser?.lastName ?? "");
  const whenLabel = `${formatDate(booking.startAt, { weekday: "long", timeZone: booking.timeZone })} at ${formatTime(booking.startAt, booking.timeZone)}`;
  const templates = await brandedEmailTemplates();

  const recipients = [
    {
      userId: booking.purchaserId,
      firstName: purchaser?.firstName ?? "there",
      href: `/bookings/${booking._id}`,
      otherName: tutorName,
      isTutor: false,
    },
    {
      userId: booking.tutorUserId,
      firstName: tutorUser?.firstName ?? "there",
      href: `/tutor/bookings/${booking._id}`,
      otherName: "your student",
      isTutor: true,
    },
  ];

  for (const recipient of recipients) {
    await notify({
      userId: recipient.userId,
      type: NOTIFICATION_TYPES.BOOKING_REMINDER,
      title: `Your ${booking.courseName} lesson is ${reminder.label}`,
      body: `${whenLabel}. ${booking.mode === LESSON_MODES.ONLINE ? "The joining link is on the lesson page." : "Check the location on the lesson page."}`,
      href: recipient.href,
      entityType: "Booking",
      entityId: booking._id,
      channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
      email: templates.bookingReminder({
        firstName: recipient.firstName,
        booking: bookingEmailPayload(booking, recipient.otherName),
        whenLabel: reminder.label,
        isTutor: recipient.isTutor,
      }),
    });
  }
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
