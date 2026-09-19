import "server-only";
import { Availability, Booking, TutorProfile } from "@/models";
import { BLOCKING_BOOKING_STATUSES } from "@/constants";
import { NotFoundError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { addDays, rangesOverlap } from "@/lib/utils/time";
import { generateSlots, firstAvailableSlot } from "@/lib/booking/slots";
import { externalBusyPeriods } from "./calendar.service";
import { getSettings } from "./settings.service";

/**
 * Availability reads and writes (§18).
 *
 * All slot computation runs server-side: the client receives a list of
 * bookable instants, never the raw rules plus a promise to behave.
 */

export async function getAvailability(tutorProfileId) {
  const doc = await Availability.findOne({ tutorProfileId }).lean();
  return doc ? toPlain(doc) : null;
}

export async function getOrCreateAvailability(tutorProfileId, userId, timeZone) {
  let doc = await Availability.findOne({ tutorProfileId });
  if (!doc) {
    doc = await Availability.create({
      tutorProfileId,
      userId,
      timeZone: timeZone ?? "America/Toronto",
      weeklyRules: [],
    });
  }
  return toPlain(doc);
}

/**
 * Bookable slots for a tutor. `bookings` are loaded for exactly the window
 * being rendered so the query stays bounded however far ahead we look.
 */
export async function getBookableSlots(
  tutorProfileId,
  { from, days = 14, durationMinutes = 60 } = {},
) {
  const [availability, settings] = await Promise.all([
    Availability.findOne({ tutorProfileId }).lean(),
    getSettings(),
  ]);

  if (!availability?.weeklyRules?.length) {
    return { days: [], timeZone: "America/Toronto", hasAvailability: false };
  }

  const fromDate = from ? new Date(`${from}T00:00:00Z`) : new Date();
  const windowEnd = addDays(fromDate, days + 1);

  // A tutor's other commitments are not in this platform, and a slot offered
  // over one is a slot that gets cancelled. Connected calendars contribute
  // busy periods in exactly the shape a booking does, so the slot generator
  // needs to know nothing about calendars (§18, §41 Phase 2).
  const [bookings, external] = await Promise.all([
    Booking.find({
      tutorProfileId,
      status: { $in: BLOCKING_BOOKING_STATUSES },
      startAt: { $lt: windowEnd },
      endAt: { $gt: fromDate },
    })
      .select("startAt endAt")
      .lean(),
    externalBusyPeriods(tutorProfileId, { from: fromDate, to: windowEnd }),
  ]);

  const generated = generateSlots({
    availability,
    bookings: [...bookings, ...external],
    durationMinutes,
    fromDate,
    days,
    minNoticeHours: settings.minimumBookingNoticeHours,
    horizonDays: settings.bookingHorizonDays,
  });

  return {
    days: generated,
    timeZone: availability.timeZone,
    hasAvailability: generated.some((d) => d.hasAvailability),
    slotIncrementMinutes: availability.slotIncrementMinutes,
  };
}

export async function updateAvailabilityRules(userId, patch) {
  const availability = await Availability.findOne({ userId });
  if (!availability) throw new NotFoundError("Set up your tutor profile first.");

  if (patch.weeklyRules) {
    assertNoOverlappingRules(patch.weeklyRules);
    await assertRulesDoNotOrphanBookings(availability.tutorProfileId, patch.weeklyRules);
  }

  Object.assign(availability, compact(patch));
  await availability.save();

  await refreshNextAvailable(availability.tutorProfileId);
  return toPlain(availability);
}

/** Two windows on the same weekday must not overlap. */
function assertNoOverlappingRules(rules) {
  const byDay = new Map();
  for (const rule of rules) {
    const list = byDay.get(rule.weekday) ?? [];
    for (const other of list) {
      if (rule.startMinutes < other.endMinutes && other.startMinutes < rule.endMinutes) {
        throw new BusinessRuleError(
          "Two availability windows on the same day overlap. Merge them into one.",
          "OVERLAPPING_AVAILABILITY",
        );
      }
    }
    list.push(rule);
    byDay.set(rule.weekday, list);
  }
}

/**
 * Narrowing availability must not strand a confirmed lesson. Tutors cancel
 * explicitly — availability edits never cancel on their behalf (§18, §26).
 */
async function assertRulesDoNotOrphanBookings(tutorProfileId, rules) {
  const upcoming = await Booking.find({
    tutorProfileId,
    status: { $in: BLOCKING_BOOKING_STATUSES },
    startAt: { $gt: new Date() },
  })
    .select("startAt endAt reference")
    .lean();

  if (!upcoming.length) return;

  const availability = await Availability.findOne({ tutorProfileId }).lean();
  const timeZone = availability?.timeZone ?? "America/Toronto";

  const orphaned = upcoming.filter((booking) => {
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(booking.startAt);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    const minutes = minutesInZone(booking.startAt, timeZone);
    const endMinutes = minutes + (booking.endAt - booking.startAt) / 60000;

    return !rules.some(
      (r) => r.weekday === weekday && minutes >= r.startMinutes && endMinutes <= r.endMinutes,
    );
  });

  if (orphaned.length) {
    throw new BusinessRuleError(
      `${orphaned.length} confirmed lesson${orphaned.length === 1 ? "" : "s"} fall outside your new availability (${orphaned
        .map((b) => b.reference)
        .join(", ")}). Cancel or reschedule them first.`,
      "AVAILABILITY_CONFLICT",
    );
  }
}

function minutesInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(date));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return (Number(map.hour) % 24) * 60 + Number(map.minute);
}

/** Block a date range: a specific day, an afternoon, or a vacation (§18). */
export async function addException(userId, exception) {
  const availability = await Availability.findOne({ userId });
  if (!availability) throw new NotFoundError("Set up your tutor profile first.");

  const start = new Date(exception.start);
  const end = new Date(exception.end);

  if (exception.kind !== "EXTRA") {
    const clashing = await Booking.find({
      tutorProfileId: availability.tutorProfileId,
      status: { $in: BLOCKING_BOOKING_STATUSES },
      startAt: { $lt: end },
      endAt: { $gt: start },
    })
      .select("reference startAt")
      .lean();

    if (clashing.length) {
      throw new BusinessRuleError(
        `You have ${clashing.length} lesson${clashing.length === 1 ? "" : "s"} booked in that period (${clashing
          .map((b) => b.reference)
          .join(", ")}). Cancel or reschedule them before blocking the time.`,
        "BOOKING_CONFLICT",
      );
    }
  }

  availability.exceptions.push({ ...exception, start, end });
  await availability.save();
  await refreshNextAvailable(availability.tutorProfileId);

  return toPlain(availability);
}

export async function removeException(userId, exceptionId) {
  const availability = await Availability.findOne({ userId });
  if (!availability) throw new NotFoundError("Set up your tutor profile first.");

  const before = availability.exceptions.length;
  availability.exceptions = availability.exceptions.filter(
    (e) => String(e._id) !== String(exceptionId),
  );
  if (availability.exceptions.length === before) {
    throw new NotFoundError("That block no longer exists.");
  }

  await availability.save();
  await refreshNextAvailable(availability.tutorProfileId);
  return toPlain(availability);
}

/**
 * Cache the soonest bookable instant on the profile so search result cards
 * can show "next available" without generating slots per card (§14).
 */
export async function refreshNextAvailable(tutorProfileId) {
  const { days } = await getBookableSlots(tutorProfileId, { days: 21, durationMinutes: 60 });
  const slot = firstAvailableSlot(days);
  await TutorProfile.updateOne(
    { _id: tutorProfileId },
    { $set: { nextAvailableAt: slot ? new Date(slot.startAt) : null } },
  );
  return slot;
}

/** The tutor's own calendar view: availability plus real bookings. */
export async function getTutorCalendar(tutorProfileId, { from, days = 7 } = {}) {
  const fromDate = from ? new Date(`${from}T00:00:00Z`) : new Date();
  const toDate = addDays(fromDate, days);

  const [availability, bookings] = await Promise.all([
    Availability.findOne({ tutorProfileId }).lean(),
    Booking.find({
      tutorProfileId,
      startAt: { $lt: toDate },
      endAt: { $gt: fromDate },
    })
      .populate("studentProfileId", "firstName lastName isMinor shareFullNameWithTutor")
      .sort({ startAt: 1 })
      .lean(),
  ]);

  return {
    availability: availability ? toPlain(availability) : null,
    bookings: toPlain(bookings),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

export { rangesOverlap };
