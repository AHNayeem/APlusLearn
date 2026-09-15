/**
 * Platform defaults. Anything an administrator can change at runtime lives in
 * the Settings collection and falls back to these values (§20, §26).
 */

export const SITE = {
  name: "APlus Learn",
  tagline: "Canada's trusted tutoring marketplace",
  description:
    "Find verified Canadian tutors for your child's exact course — online or in person. Compare, message and book lessons with transparent pricing.",
  supportEmail: "support@apluslearn.ca",
  supportPhone: "1-888-555-0142",
  supportHours: "Mon to Sun, 9am – 9pm ET",
  city: "Toronto, Ontario",
  /** Public profiles linked from the footer. Blank entries are not rendered. */
  social: {
    facebook: "https://www.facebook.com/apluslearn",
    x: "https://x.com/apluslearn",
    linkedin: "https://www.linkedin.com/company/apluslearn",
    instagram: "https://www.instagram.com/apluslearn",
    youtube: "https://www.youtube.com/@apluslearn",
  },
  locale: "en-CA",
  currency: "CAD",
  country: "CA",
};

export const DEFAULT_SETTINGS = {
  /** Platform commission taken from each lesson, as a percentage. */
  commissionPercent: 15,

  /** Hours before lesson start when a free cancellation is still possible. */
  freeCancellationWindowHours: 24,

  /** Refund percentage for cancellations inside the free window. */
  lateCancellationRefundPercent: 50,

  /** Refund percentage when a student does not attend. */
  studentNoShowRefundPercent: 0,

  /** Refund percentage when a tutor does not attend. */
  tutorNoShowRefundPercent: 100,

  /** Cancellations inside a rolling window before a warning is issued. */
  cancellationAbuseThreshold: 3,
  cancellationAbuseWindowDays: 30,

  /** Minimum notice required to book a lesson. */
  minimumBookingNoticeHours: 4,

  /** How far ahead the calendar accepts bookings. */
  bookingHorizonDays: 60,

  /** Tutor pricing guard rails, in CAD per hour. */
  minHourlyRate: 15,
  maxHourlyRate: 250,

  /** Days after a completed lesson before funds become payable. */
  payoutHoldDays: 3,

  /** Default radius for in-person distance search, in kilometres. */
  defaultSearchRadiusKm: 25,

  /** Reviews longer than this are queued for moderation. */
  autoModerateReviews: false,
};

export const PAGE_SIZES = {
  tutorSearch: 12,
  bookings: 10,
  messages: 30,
  reviews: 8,
  adminTable: 20,
  notifications: 20,
};

/** Distance filter options for in-person search, in kilometres. */
export const DISTANCE_OPTIONS = [5, 10, 25, 50, 100];

/** Hourly-rate filter bounds used by the search UI. */
export const PRICE_RANGE = { min: 15, max: 150, step: 5 };

export const RATING_OPTIONS = [4.5, 4, 3.5, 3];

export const EXPERIENCE_OPTIONS = [
  { value: 1, label: "1+ years" },
  { value: 3, label: "3+ years" },
  { value: 5, label: "5+ years" },
  { value: 10, label: "10+ years" },
];

export const AVAILABILITY_WINDOWS = [
  { value: "WEEKDAY_MORNING", label: "Weekday mornings", days: [1, 2, 3, 4, 5], from: 6, to: 12 },
  { value: "WEEKDAY_AFTERNOON", label: "Weekday afternoons", days: [1, 2, 3, 4, 5], from: 12, to: 17 },
  { value: "WEEKDAY_EVENING", label: "Weekday evenings", days: [1, 2, 3, 4, 5], from: 17, to: 22 },
  { value: "WEEKEND", label: "Weekends", days: [0, 6], from: 8, to: 21 },
];

/** Session cookie name and lifetime. */
export const SESSION = {
  cookieName: "aplus_session",
  maxAgeSeconds: 60 * 60 * 24 * 14, // 14 days
};

export const UPLOAD = {
  maxDocumentBytes: 8 * 1024 * 1024,
  acceptedDocumentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
};
