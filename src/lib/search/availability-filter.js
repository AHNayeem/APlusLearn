import {
  AVAILABILITY_WINDOWS,
  SEARCH_TIME_OF_DAY,
  SEARCH_AVAILABILITY_LOOKAHEAD_DAYS,
} from "@/constants";
import { dayKeyInZone } from "@/lib/utils/time";

/**
 * Search availability as a question about a tutor's real calendar (§8,
 * R8.17–R8.21).
 *
 * Pure. `buildAvailabilityFilter` turns the visitor's choices into
 * `{ days, acceptFor }`, the shape `availability.service.firstOpenSlots`
 * takes: `days` is how far ahead to look, and `acceptFor(availability)`
 * returns the test a free slot must pass for that tutor. A tutor matches
 * when at least one *bookable* slot passes — so exceptions, vacations,
 * existing bookings, group sessions, notice and the booking horizon all
 * count, exactly as they do in the booking calendar.
 *
 * Two independent questions, ANDed: *which day* (today, tomorrow, this
 * week, this weekend, or a specific date — any of those chosen) and *what
 * time* (a specific start time, or any of the chosen times of day). Either
 * may be absent. Days are the tutor's own calendar days, in their zone.
 */

const DAY_MS = 86400000;
const LEGACY_WINDOWS = AVAILABILITY_WINDOWS.filter((w) => w.value.startsWith("WEEKDAY_"));
const DAY_VALUES = ["TODAY", "TOMORROW", "THIS_WEEK", "WEEKEND"];

/** Whole days from `fromKey` to `toKey` ("YYYY-MM-DD"). */
function dayOffset(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T12:00:00Z`) - Date.parse(`${fromKey}T12:00:00Z`)) / DAY_MS);
}

function keyPlus(key, days) {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The calendar days a day filter covers, as keys in `timeZone`. */
export function daysFor(value, { now = new Date(), timeZone }) {
  const today = dayKeyInZone(now, timeZone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  switch (value) {
    case "TODAY":
      return [today];
    case "TOMORROW":
      return [keyPlus(today, 1)];
    case "THIS_WEEK": {
      // Today through the coming Sunday (a Sunday is its own last day).
      const remaining = weekday === 0 ? 0 : 7 - weekday;
      return Array.from({ length: remaining + 1 }, (_, i) => keyPlus(today, i));
    }
    case "WEEKEND": {
      if (weekday === 0) return [today];
      if (weekday === 6) return [today, keyPlus(today, 1)];
      return [keyPlus(today, 6 - weekday), keyPlus(today, 7 - weekday)];
    }
    default:
      return [];
  }
}

/** "16:30" → 990, or null. */
function minutesOf(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time ?? ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Whether the visitor asked anything about availability at all. */
export function hasAvailabilityFilter(params = {}) {
  return Boolean(params.availability?.length || params.timeOfDay?.length || params.date || params.time);
}

/**
 * @returns {null | { days: number, acceptFor: (availability) => (slot) => boolean }}
 */
export function buildAvailabilityFilter(params = {}, { now = new Date() } = {}) {
  if (!hasAvailabilityFilter(params)) return null;

  const dayValues = (params.availability ?? []).filter((v) => DAY_VALUES.includes(v));
  const legacy = LEGACY_WINDOWS.filter((w) => (params.availability ?? []).includes(w.value));
  const times = SEARCH_TIME_OF_DAY.filter((w) => (params.timeOfDay ?? []).includes(w.value));
  const exactMinutes = minutesOf(params.time);

  // How far ahead to look. A specific date may be weeks out; the slot
  // generator still stops at the booking horizon.
  const serverToday = now.toISOString().slice(0, 10);
  let days = dayValues.length || params.date ? 1 : SEARCH_AVAILABILITY_LOOKAHEAD_DAYS;
  if (dayValues.includes("THIS_WEEK") || dayValues.includes("WEEKEND")) days = Math.max(days, 9);
  if (dayValues.includes("TOMORROW")) days = Math.max(days, 3);
  if (dayValues.includes("TODAY")) days = Math.max(days, 2);
  if (params.date) days = Math.max(days, dayOffset(serverToday, params.date) + 2);

  const acceptFor = (availability) => {
    const timeZone = availability?.timeZone || "America/Toronto";
    const wantedDays = new Set(dayValues.flatMap((value) => daysFor(value, { now, timeZone })));
    if (params.date) wantedDays.add(params.date);

    return (slot) => {
      if (wantedDays.size && !wantedDays.has(slot.dayKey)) return false;
      if (exactMinutes !== null && slot.minutes !== exactMinutes) return false;
      if (times.length && !times.some((w) => slot.minutes >= w.from * 60 && slot.minutes < w.to * 60)) {
        return false;
      }
      // Older links: "weekday evenings" etc. — the same question of the
      // real calendar, restricted to weekdays.
      if (
        legacy.length &&
        !legacy.some(
          (w) => w.days.includes(slot.weekday) && slot.minutes >= w.from * 60 && slot.minutes < w.to * 60,
        )
      ) {
        return false;
      }
      return true;
    };
  };

  return { days: Math.max(1, Math.min(days, 400)), acceptFor };
}
