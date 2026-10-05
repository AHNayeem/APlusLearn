import "server-only";
import { maskLearnersForTutor } from "@/lib/privacy/learner";
import { Types } from "mongoose";
import { Availability, Booking, TutorProfile, GroupSession } from "@/models";
import { BLOCKING_BOOKING_STATUSES, GROUP_SESSION_STATUS } from "@/constants";
import { NotFoundError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { addDays, rangesOverlap } from "@/lib/utils/time";
import { generateSlots, findFirstSlot } from "@/lib/booking/slots";
import { externalBusyPeriodsForTutors } from "./calendar.service";
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
 * Group sessions that occupy the tutor's time. A published session holds the
 * hour whether or not anyone has joined yet — otherwise a one-to-one lesson
 * could be sold on top of it and the first family to join would find the
 * tutor double-booked (R14.4).
 */
const LIVE_GROUP_STATUSES = [GROUP_SESSION_STATUS.PUBLISHED, GROUP_SESSION_STATUS.CONFIRMED];

const asObjectId = (id) => (id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id)));

/**
 * Everything that occupies each tutor's time between `from` and `to`: their
 * blocking bookings, their live group sessions and the busy time of any
 * connected external calendar (§18, §41 Phase 2). Returns a Map of
 * tutorProfileId → [{ startAt, endAt }].
 *
 * The one definition of "busy". Slot display, the booking claim, a
 * reschedule, publishing a group session and search all read it, so none of
 * them can offer or accept an hour another one considers taken.
 * `excludeBookingId` leaves out the lesson being moved by a reschedule.
 */
export async function busyPeriodsForTutors(tutorProfileIds, { from = new Date(), to, excludeBookingId } = {}) {
  const ids = [...new Set((tutorProfileIds ?? []).filter(Boolean).map(String))];
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;

  const until = to ?? addDays(from, 60);
  const objectIds = ids.map(asObjectId);

  const bookingQuery = {
    tutorProfileId: { $in: objectIds },
    status: { $in: BLOCKING_BOOKING_STATUSES },
    startAt: { $lt: until },
    endAt: { $gt: from },
  };
  if (excludeBookingId) bookingQuery._id = { $ne: asObjectId(excludeBookingId) };

  const [bookings, sessions, external] = await Promise.all([
    Booking.find(bookingQuery).select("tutorProfileId startAt endAt").lean(),
    GroupSession.find({
      tutorProfileId: { $in: objectIds },
      status: { $in: LIVE_GROUP_STATUSES },
      startAt: { $lt: until },
      endAt: { $gt: from },
    })
      .select("tutorProfileId startAt endAt")
      .lean(),
    externalBusyPeriodsForTutors(objectIds, { from, to: until }),
  ]);

  for (const row of [...bookings, ...sessions]) {
    map.get(String(row.tutorProfileId))?.push({ startAt: row.startAt, endAt: row.endAt });
  }
  for (const [id, periods] of external) map.get(id)?.push(...periods);
  return map;
}

/** `busyPeriodsForTutors` for one tutor. */
export async function tutorBusyPeriods(tutorProfileId, options = {}) {
  const map = await busyPeriodsForTutors([tutorProfileId], options);
  return map.get(String(tutorProfileId)) ?? [];
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

  // A tutor's other commitments — bookings, group sessions, a connected
  // calendar — arrive in one shape, so the slot generator needs to know
  // nothing about where they came from (§18, §41 Phase 2).
  const busy = await tutorBusyPeriods(tutorProfileId, { from: fromDate, to: windowEnd });

  const generated = generateSlots({
    availability,
    bookings: busy,
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
 * The first open slot of each tutor that `acceptFor(availability)` accepts,
 * computed from their real calendar (§8, §9).
 *
 * This is how search answers "who can teach today", "this weekend" or
 * "Tuesday at 4:30" and what a result card shows as next available: the
 * same weekly rules, blocked periods, notice, horizon and busy time the
 * booking calendar uses — never the weekly template alone, and never a
 * cached value that a booking made since could have made wrong.
 *
 * Returns a Map of tutorProfileId → slot (`{ startAt, minutes, dayKey,
 * weekday }` in the tutor's zone) or null.
 */
export async function firstOpenSlots(
  tutorProfileIds,
  { from = new Date(), days, durationMinutes = 60, acceptFor } = {},
) {
  const ids = [...new Set((tutorProfileIds ?? []).filter(Boolean).map(String))];
  const result = new Map(ids.map((id) => [id, null]));
  if (!ids.length) return result;

  const settings = await getSettings();
  const horizonDays = settings.bookingHorizonDays ?? 60;
  const span = Math.min(days ?? horizonDays, horizonDays + 1);
  const until = addDays(from, span + 1);

  const [availabilities, busy] = await Promise.all([
    Availability.find({ tutorProfileId: { $in: ids.map(asObjectId) } }).lean(),
    busyPeriodsForTutors(ids, { from, to: until }),
  ]);

  for (const availability of availabilities) {
    const id = String(availability.tutorProfileId);
    if (!availability.weeklyRules?.length) continue;
    const slot = findFirstSlot(
      {
        availability,
        bookings: busy.get(id) ?? [],
        durationMinutes,
        fromDate: from,
        days: span,
        minNoticeHours: settings.minimumBookingNoticeHours,
        horizonDays,
      },
      acceptFor ? acceptFor(availability) : undefined,
    );
    result.set(id, slot);
  }
  return result;
}

/** Each tutor's soonest bookable instant (a Date) or null. */
export async function nextAvailableFor(tutorProfileIds) {
  const slots = await firstOpenSlots(tutorProfileIds);
  return new Map([...slots].map(([id, slot]) => [id, slot ? new Date(slot.startAt) : null]));
}

/**
 * Keep the stored copy of a tutor's soonest bookable instant current.
 *
 * Search no longer reads it — cards and the "soonest available" sort compute
 * it live (`nextAvailableFor`) — but it is still written on every change to
 * availability or bookings, so anything that does read it (an export, an
 * admin list) is not stale either.
 */
export async function refreshNextAvailable(tutorProfileId) {
  const map = await nextAvailableFor([tutorProfileId]);
  const next = map.get(String(tutorProfileId)) ?? null;
  await TutorProfile.updateOne({ _id: tutorProfileId }, { $set: { nextAvailableAt: next } });
  return next ? { startAt: next.toISOString() } : null;
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
    // The calendar is the tutor's own view, so learners are masked (S5).
    bookings: maskLearnersForTutor(toPlain(bookings)),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
  };
}

export { rangesOverlap };
