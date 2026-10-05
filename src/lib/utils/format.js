import { SITE, DEFAULT_SETTINGS } from "@/constants/config";

const CAD = new Intl.NumberFormat(SITE.locale, {
  style: "currency",
  currency: SITE.currency,
  minimumFractionDigits: 2,
});

const CAD_COMPACT = new Intl.NumberFormat(SITE.locale, {
  style: "currency",
  currency: SITE.currency,
  maximumFractionDigits: 0,
});

/**
 * Money is stored in cents everywhere. Never format a float.
 */
export function formatMoney(cents, { compact = false } = {}) {
  const amount = (Number(cents) || 0) / 100;
  return compact && Number.isInteger(amount) ? CAD_COMPACT.format(amount) : CAD.format(amount);
}

export function formatRate(cents) {
  return `${CAD_COMPACT.format((Number(cents) || 0) / 100)}/hr`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat(SITE.locale).format(Number(value) || 0);
}

export function formatPercent(value, fractionDigits = 0) {
  return new Intl.NumberFormat(SITE.locale, {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format((Number(value) || 0) / 100);
}

export function formatDate(date, options = {}) {
  if (!date) return "";
  return new Intl.DateTimeFormat(SITE.locale, {
    weekday: options.weekday,
    year: "numeric",
    month: options.month ?? "short",
    day: "numeric",
    timeZone: options.timeZone,
  }).format(new Date(date));
}

export function formatTime(date, timeZone) {
  if (!date) return "";
  return new Intl.DateTimeFormat(SITE.locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(date));
}

export function formatDateTime(date, timeZone) {
  if (!date) return "";
  return `${formatDate(date, { weekday: "short", timeZone })} · ${formatTime(date, timeZone)}`;
}

export function formatDuration(minutes) {
  const mins = Number(minutes) || 0;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${m} min`;
}

export function formatDistance(km) {
  if (km == null) return "";
  if (km < 1) return "under 1 km";
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatRelative(date) {
  if (!date) return "";
  const diff = Date.now() - new Date(date).getTime();
  const rtf = new Intl.RelativeTimeFormat(SITE.locale, { numeric: "auto" });
  const units = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return "just now";
}

/**
 * Public-facing tutor name: first name + last initial only (§14).
 * Full surnames are never exposed on public pages.
 */
export function publicName(firstName = "", lastName = "") {
  const initial = lastName.trim().charAt(0);
  return initial ? `${firstName} ${initial}.` : firstName;
}

/**
 * How a learner's name reads to a tutor (§35, §42).
 *
 * A minor is a first name plus an initial unless the family opted in to
 * sharing the full name. One implementation, because this is a privacy rule
 * rather than a formatting preference — a second copy is a place for the two
 * to disagree about a child's surname.
 */
export function learnerDisplayName(student, { forTutor = true } = {}) {
  if (!student) return "your student";

  const first = student.firstName ?? "";
  const last = student.lastName ?? "";
  const masked = forTutor && student.isMinor && !student.shareFullNameWithTutor;

  if (masked) return publicName(first, last);
  return `${first} ${last}`.trim() || first;
}

export function initials(firstName = "", lastName = "") {
  return `${firstName.charAt(0) ?? ""}${lastName.charAt(0) ?? ""}`.toUpperCase() || "?";
}

export function pluralize(count, singular, plural) {
  return Number(count) === 1 ? singular : (plural ?? `${singular}s`);
}

/**
 * A file size a person can read.
 *
 * Binary units, because that is what a file manager shows and a family
 * comparing "8 MB" on the upload hint with "8.2 MB" here should not have to
 * know which of the two meanings of "MB" each one meant.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function truncate(text = "", length = 160) {
  if (text.length <= length) return text;
  return `${text.slice(0, text.lastIndexOf(" ", length))}…`;
}

/**
 * "2 business days" — a service level as copy (§12, §33).
 *
 * The number always comes from platform settings; this only words it, so the
 * become-a-tutor page, the tutor workspace and the application email cannot
 * phrase the same promise three different ways.
 */
export function businessDaysLabel(days) {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 1) return null;
  return `${formatNumber(n)} business ${n === 1 ? "day" : "days"}`;
}

/**
 * How long a tutor application review takes, from settings
 * (`applicationReviewBusinessDays`). Accepts the settings document, the
 * `policy` group from `getAppConfig()`, or anything else carrying the field.
 */
export function applicationReviewLabel(settings) {
  return businessDaysLabel(
    settings?.applicationReviewBusinessDays ?? DEFAULT_SETTINGS.applicationReviewBusinessDays,
  );
}

/** How soon support replies, from settings (`supportResponseBusinessDays`). */
export function supportResponseLabel(settings) {
  return businessDaysLabel(
    settings?.supportResponseBusinessDays ?? DEFAULT_SETTINGS.supportResponseBusinessDays,
  );
}
