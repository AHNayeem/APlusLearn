import {
  dayKeyInZone,
  minutesInZone,
  zonedTimeToUtc,
  addDays,
  addMinutes,
  rangesOverlap,
  minutesToLabel,
} from "@/lib/utils/time";

/**
 * Availability slot generation (§18).
 *
 * Weekly rules are wall-clock times in the tutor's own timezone. For each day
 * in the requested window we project those rules onto real UTC instants, then
 * subtract exceptions and existing bookings. A slot is only offered when the
 * *entire* lesson (plus buffer) fits inside a free window — which is what
 * makes double-booking structurally impossible rather than merely checked.
 */

/**
 * Every free slot, in time order, one day at a time.
 *
 * The single place the slot rules live — weekly rules projected onto real
 * instants in the tutor's zone, minus notice, horizon, blocked periods and
 * busy time widened by the buffer. `generateSlots` collects it for the
 * calendar; `findFirstSlot` stops at the first match for search (§8, §9),
 * so a search card and the booking calendar can never disagree.
 */
function* iterateDays({
  availability,
  bookings = [],
  durationMinutes = 60,
  fromDate = new Date(),
  days = 14,
  minNoticeHours = 4,
  horizonDays = 60,
  now = new Date(),
}) {
  const timeZone = availability.timeZone || "America/Toronto";
  const buffer = availability.bufferMinutes ?? 0;
  const increment = availability.slotIncrementMinutes ?? 30;
  const notice = Math.max(minNoticeHours, availability.minNoticeHours ?? 0);

  const earliest = addMinutes(now, notice * 60);
  const latest = addDays(now, horizonDays);

  // Group rules by weekday once rather than filtering inside the day loop.
  const rulesByWeekday = new Map();
  for (const rule of availability.weeklyRules ?? []) {
    if (!rulesByWeekday.has(rule.weekday)) rulesByWeekday.set(rule.weekday, []);
    rulesByWeekday.get(rule.weekday).push(rule);
  }

  const blocked = (availability.exceptions ?? []).filter((e) => e.kind !== "EXTRA");

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const cursor = addDays(fromDate, dayOffset);
    const key = dayKeyInZone(cursor, timeZone);
    // Weekday *in the tutor's zone*, not the server's.
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();

    const rules = [...(rulesByWeekday.get(weekday) ?? [])].sort((a, b) => a.startMinutes - b.startMinutes);
    const daySlots = [];

    for (const rule of rules) {
      for (
        let minute = rule.startMinutes;
        minute + durationMinutes <= rule.endMinutes;
        minute += increment
      ) {
        const start = zonedTimeToUtc(key, minute, timeZone);
        const end = addMinutes(start, durationMinutes);

        if (start < earliest || start > latest) continue;

        // Tutor-declared unavailability.
        const isBlocked = blocked.some((e) => rangesOverlap(start, end, e.start, e.end));
        if (isBlocked) continue;

        // Existing bookings, widened by the tutor's buffer on both sides.
        const clashes = bookings.some((b) =>
          rangesOverlap(
            addMinutes(start, -buffer),
            addMinutes(end, buffer),
            b.startAt,
            b.endAt,
          ),
        );
        if (clashes) continue;

        daySlots.push({
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          label: minutesToLabel(minute),
          minutes: minute,
          dayKey: key,
          weekday,
        });
      }
    }

    yield { dayKey: key, weekday, slots: daySlots.sort((a, b) => a.minutes - b.minutes) };
  }
}

export function generateSlots(options) {
  if (!options.availability?.weeklyRules?.length) return [];
  const results = [];
  for (const day of iterateDays(options)) {
    results.push({
      dayKey: day.dayKey,
      weekday: day.weekday,
      slots: day.slots.map(({ dayKey: _d, weekday: _w, ...slot }) => slot),
      hasAvailability: day.slots.length > 0,
    });
  }
  return results;
}

/**
 * The first free slot that satisfies `accept`, or null — the same rules as
 * `generateSlots`, stopping as soon as one is found.
 *
 * `accept(slot)` sees `{ startAt, minutes, dayKey, weekday }` in the tutor's
 * own zone, which is how "today", "this weekend" or "Tuesday at 4:30" are
 * asked of a tutor's real calendar rather than of their weekly template.
 */
export function findFirstSlot(options, accept = () => true) {
  if (!options.availability?.weeklyRules?.length) return null;
  for (const day of iterateDays(options)) {
    for (const slot of day.slots) {
      if (accept(slot)) return slot;
    }
  }
  return null;
}

/**
 * Authoritative double-booking check, run inside the booking service just
 * before a booking is written (§18, §42). Slot generation is for display;
 * this is the guarantee.
 */
export function isSlotBookable({ availability, bookings, startAt, durationMinutes, settings }) {
  const start = new Date(startAt);
  const end = addMinutes(start, durationMinutes);
  const timeZone = availability?.timeZone || "America/Toronto";

  if (Number.isNaN(start.getTime())) {
    return { bookable: false, reason: "That date and time is not valid." };
  }

  const noticeHours = Math.max(
    settings?.minimumBookingNoticeHours ?? 0,
    availability?.minNoticeHours ?? 0,
  );
  if (start.getTime() - Date.now() < noticeHours * 3600_000) {
    return {
      bookable: false,
      reason: `Lessons must be booked at least ${noticeHours} hours in advance.`,
    };
  }

  const horizon = addDays(new Date(), settings?.bookingHorizonDays ?? 60);
  if (start > horizon) {
    return {
      bookable: false,
      reason: `Lessons can only be booked up to ${settings?.bookingHorizonDays ?? 60} days ahead.`,
    };
  }

  // The requested window must sit inside a weekly rule.
  const key = dayKeyInZone(start, timeZone);
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
  // Wall-clock minutes, read from the zone — not "milliseconds since local
  // midnight", which is an hour out on the two days a year the clocks change.
  const startMinutes = minutesInZone(start, timeZone);
  const endMinutes = startMinutes + durationMinutes;

  const insideRule = (availability?.weeklyRules ?? []).some(
    (rule) =>
      rule.weekday === weekday &&
      startMinutes >= rule.startMinutes &&
      endMinutes <= rule.endMinutes,
  );
  if (!insideRule) {
    return { bookable: false, reason: "The tutor is not available at that time." };
  }

  const blockedBy = (availability?.exceptions ?? [])
    .filter((e) => e.kind !== "EXTRA")
    .find((e) => rangesOverlap(start, end, e.start, e.end));
  if (blockedBy) {
    return { bookable: false, reason: "The tutor has blocked that time." };
  }

  const buffer = availability?.bufferMinutes ?? 0;
  const clash = bookings.find((b) =>
    rangesOverlap(addMinutes(start, -buffer), addMinutes(end, buffer), b.startAt, b.endAt),
  );
  if (clash) {
    return { bookable: false, reason: "That time has just been booked. Please choose another." };
  }

  return { bookable: true };
}

/** The soonest bookable slot, cached on the tutor profile for search cards. */
export function firstAvailableSlot(days) {
  for (const day of days) {
    if (day.slots.length) return day.slots[0];
  }
  return null;
}

/** Does a tutor have any availability inside a named window? (search filter) */
export function matchesAvailabilityWindow(availability, window) {
  return (availability?.weeklyRules ?? []).some(
    (rule) =>
      window.days.includes(rule.weekday) &&
      rule.startMinutes < window.to * 60 &&
      rule.endMinutes > window.from * 60,
  );
}
