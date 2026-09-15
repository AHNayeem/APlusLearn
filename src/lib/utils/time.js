/**
 * Time helpers for availability and booking.
 *
 * Availability is stored as minutes-from-midnight in the tutor's IANA
 * timezone, which keeps recurring weekly rules stable across DST changes.
 */

export const MINUTES_IN_DAY = 24 * 60;

/** "09:30" -> 570 */
export function timeToMinutes(value) {
  if (typeof value === "number") return value;
  const [h, m] = String(value).split(":").map(Number);
  return h * 60 + (m || 0);
}

/** 570 -> "09:30" */
export function minutesToTime(minutes) {
  const total = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** 570 -> "9:30 AM" */
export function minutesToLabel(minutes) {
  const total = Math.round(minutes);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Minutes offset of `date` from UTC in `timeZone`, accounting for DST. */
export function timeZoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/**
 * Build a UTC Date for a wall-clock local time in a given timezone.
 * `dayKey` is "YYYY-MM-DD" and `minutes` is minutes-from-midnight.
 */
export function zonedTimeToUtc(dayKey, minutes, timeZone) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0);
  // Two passes settle the DST boundary case.
  let guess = new Date(naive);
  for (let i = 0; i < 2; i += 1) {
    const offset = timeZoneOffsetMinutes(guess, timeZone);
    guess = new Date(naive - offset * 60000);
  }
  return guess;
}

/** "YYYY-MM-DD" for a UTC instant rendered in `timeZone`. */
export function dayKeyInZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date(date));
}

/** 0 (Sunday) – 6 (Saturday) for a UTC instant rendered in `timeZone`. */
export function weekdayInZone(date, timeZone) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(
    new Date(date),
  );
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Minutes-from-midnight for a UTC instant rendered in `timeZone`. */
export function minutesInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(date));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return (Number(map.hour) % 24) * 60 + Number(map.minute);
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

/** Inclusive-start, exclusive-end overlap test. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

export function hoursUntil(date) {
  return (new Date(date).getTime() - Date.now()) / 3600000;
}

/** Sequential "YYYY-MM-DD" keys starting at `start`. */
export function dayKeyRange(start, count, timeZone) {
  const keys = [];
  for (let i = 0; i < count; i += 1) {
    keys.push(dayKeyInZone(addDays(start, i), timeZone));
  }
  return keys;
}

export const CANADIAN_TIMEZONES = [
  { value: "America/St_Johns", label: "Newfoundland (NST)" },
  { value: "America/Halifax", label: "Atlantic (AST)" },
  { value: "America/Toronto", label: "Eastern (EST/EDT)" },
  { value: "America/Winnipeg", label: "Central (CST/CDT)" },
  { value: "America/Edmonton", label: "Mountain (MST/MDT)" },
  { value: "America/Vancouver", label: "Pacific (PST/PDT)" },
];
