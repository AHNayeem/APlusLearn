import { SITE } from "@/constants/config";

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

export function initials(firstName = "", lastName = "") {
  return `${firstName.charAt(0) ?? ""}${lastName.charAt(0) ?? ""}`.toUpperCase() || "?";
}

export function pluralize(count, singular, plural) {
  return Number(count) === 1 ? singular : (plural ?? `${singular}s`);
}

export function truncate(text = "", length = 160) {
  if (text.length <= length) return text;
  return `${text.slice(0, text.lastIndexOf(" ", length))}…`;
}
