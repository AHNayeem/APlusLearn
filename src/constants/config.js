/**
 * Platform defaults. Anything an administrator can change at runtime lives in
 * the Settings collection and falls back to these values (§20, §26).
 *
 * `SITE` is the compile-time identity: the values a request uses when the
 * database has not been reached yet, or has nothing stored. Runtime code
 * should read `getAppConfig()` from the settings service instead of importing
 * `SITE` directly — this object is the floor beneath it, not the source.
 */

export const SITE = {
  name: "APlus Learn",
  shortName: "APlus",
  tagline: "Canada's trusted tutoring marketplace",
  description:
    "Find verified Canadian tutors for your child's exact course — online or in person. Compare, message and book lessons with transparent pricing.",
  supportEmail: "support@apluslearn.ca",
  contactEmail: "hello@apluslearn.ca",
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

/**
 * Feature toggles (§26).
 *
 * Every key here is enforced server-side — a disabled feature returns 403 from
 * its endpoints, it does not merely disappear from the navigation. Only
 * features whose absence leaves the marketplace coherent are listed: search,
 * booking, payment and verification have no switch because a tutoring
 * marketplace without them is not a degraded product, it is a broken one.
 */
export const FEATURES = {
  MESSAGING: "messaging",
  FAVOURITES: "favourites",
  TUTOR_REQUESTS: "tutorRequests",
  REVIEWS: "reviews",
  ONLINE_LESSONS: "onlineLessons",
  IN_PERSON_LESSONS: "inPersonLessons",
  GOOGLE_SIGN_IN: "googleSignIn",
  APPLE_SIGN_IN: "appleSignIn",
};

export const FEATURE_LABELS = {
  [FEATURES.MESSAGING]: "Messaging",
  [FEATURES.FAVOURITES]: "Saved tutors",
  [FEATURES.TUTOR_REQUESTS]: "Tutor requests",
  [FEATURES.REVIEWS]: "Reviews",
  [FEATURES.ONLINE_LESSONS]: "Online lessons",
  [FEATURES.IN_PERSON_LESSONS]: "In-person lessons",
  [FEATURES.GOOGLE_SIGN_IN]: "Google sign-in",
  [FEATURES.APPLE_SIGN_IN]: "Apple sign-in",
};

/**
 * Email categories, used to route a message through the platform-level
 * notification switches.
 *
 * `SECURITY` is not a category an administrator can reach. Password resets,
 * email verification and "your password changed" alerts are how an account
 * owner keeps control of their account; a settings toggle that silently
 * stopped them would be a security incident waiting to happen (§36).
 */
export const EMAIL_CATEGORIES = {
  SECURITY: "SECURITY",
  BOOKING: "BOOKING",
  APPLICATION: "APPLICATION",
  REVIEW: "REVIEW",
  PAYOUT: "PAYOUT",
  ANNOUNCEMENT: "ANNOUNCEMENT",
};

/** Which platform switch gates each category. SECURITY is absent by design. */
export const EMAIL_CATEGORY_SETTING = {
  [EMAIL_CATEGORIES.BOOKING]: "bookingEmails",
  [EMAIL_CATEGORIES.APPLICATION]: "applicationEmails",
  [EMAIL_CATEGORIES.REVIEW]: "reviewEmails",
  [EMAIL_CATEGORIES.PAYOUT]: "payoutEmails",
  [EMAIL_CATEGORIES.ANNOUNCEMENT]: "announcementEmails",
};

/**
 * Branding assets an administrator can upload, and the rules each is held to.
 *
 * Bounds are deliberately tight. These files are served to every visitor on
 * every page, so a 6 MB "logo" is not a preference — it is a performance
 * regression for the whole marketplace.
 */
export const BRANDING_ASSETS = {
  logo: {
    key: "logo",
    label: "Logo",
    hint: "Shown in the header, dashboard sidebar and emails. A transparent PNG works best.",
    accepts: ["image/png", "image/webp", "image/jpeg"],
    maxBytes: 512 * 1024,
    minWidth: 48,
    minHeight: 24,
    maxWidth: 1600,
    maxHeight: 800,
  },
  logoDark: {
    key: "logoDark",
    label: "Logo for dark backgrounds",
    hint: "Used in the footer. Falls back to the wordmark when not set.",
    accepts: ["image/png", "image/webp", "image/jpeg"],
    maxBytes: 512 * 1024,
    minWidth: 48,
    minHeight: 24,
    maxWidth: 1600,
    maxHeight: 800,
  },
  favicon: {
    key: "favicon",
    label: "Favicon",
    hint: "Square browser tab icon. 32×32 or larger.",
    accepts: ["image/png", "image/x-icon", "image/webp"],
    maxBytes: 128 * 1024,
    minWidth: 16,
    minHeight: 16,
    maxWidth: 512,
    maxHeight: 512,
    square: true,
  },
  appleTouchIcon: {
    key: "appleTouchIcon",
    label: "Apple touch icon",
    hint: "Square home-screen icon for iOS. 180×180 recommended.",
    accepts: ["image/png", "image/webp"],
    maxBytes: 256 * 1024,
    minWidth: 120,
    minHeight: 120,
    maxWidth: 512,
    maxHeight: 512,
    square: true,
  },
  ogImage: {
    key: "ogImage",
    label: "Social preview image",
    hint: "Shown when a page is shared. 1200×630 is the standard size.",
    accepts: ["image/png", "image/jpeg", "image/webp"],
    maxBytes: 1024 * 1024,
    minWidth: 600,
    minHeight: 315,
    maxWidth: 2400,
    maxHeight: 1260,
  },
};

export const BRANDING_ASSET_KEYS = Object.keys(BRANDING_ASSETS);

/**
 * How long an unpaid booking holds its slot (§19, §20).
 *
 * This is the *only* place the number lives. Three things read it and they
 * must not drift apart:
 *
 *   1. the payment provider, which sets its hosted checkout session to expire
 *      at `minutes` (Stripe's `expires_at`);
 *   2. the `booking-expiry` scheduled job, which releases PENDING_PAYMENT
 *      bookings once `minutes` have passed since the booking was created;
 *   3. the checkout page, which tells the purchaser how long they have.
 *
 * `graceMinutes` is added only to a *provider-stated* session expiry, so the
 * sweep never races the provider's clock: the session is already dead by the
 * time anything is released, and a webhook that arrives in the last moments
 * still finds its bookings held. Our own window needs no slack — it is
 * measured from a timestamp this application wrote.
 *
 * Stripe's minimum session lifetime is 30 minutes and its maximum is 24
 * hours, so `minutes` must stay inside that range.
 */
export const CHECKOUT_HOLD = {
  minutes: 60,
  graceMinutes: 10,
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

  /**
   * Minutes an unpaid booking holds its slot before the `booking-expiry` job
   * releases it (§19). Defaults to `CHECKOUT_HOLD.minutes`; an operator can
   * tighten it on a busy marketplace or loosen it for slower payment methods.
   * The hosted checkout session is created with the same window, so the two
   * cannot drift.
   */
  checkoutHoldMinutes: CHECKOUT_HOLD.minutes,

  /** Tutor pricing guard rails, in CAD per hour. */
  minHourlyRate: 15,
  maxHourlyRate: 250,

  /** Days after a completed lesson before funds become payable. */
  payoutHoldDays: 3,

  /** Create payouts automatically when the scheduler runs (§20). */
  autoPayouts: true,

  /** Default radius for in-person distance search, in kilometres. */
  defaultSearchRadiusKm: 25,

  /** Reviews longer than this are queued for moderation. */
  autoModerateReviews: false,

  // --- Presentation ------------------------------------------------------
  // Everything below is how the platform introduces itself. None of it can
  // change a price, a refund or who may see what; those stay above.

  branding: {
    appName: SITE.name,
    shortName: SITE.shortName,
    tagline: SITE.tagline,
    description: SITE.description,
    /** Uploaded assets: null until an administrator provides one. */
    logo: null,
    logoDark: null,
    favicon: null,
    appleTouchIcon: null,
    ogImage: null,
  },

  theme: {
    /** brand-600 — solid buttons, links, focus rings. */
    primaryColor: "#2348d6",
    /** accent-500 — highlights, ratings, secondary calls to action. */
    accentColor: "#fe7b12",
    successColor: "#22c55e",
    warningColor: "#f59e0b",
    dangerColor: "#ef4444",
    /** Page ground and card ground. */
    canvasColor: "#f7f9fc",
    surfaceColor: "#ffffff",
    /** The deep footer band — the one dark surface the light theme carries. */
    footerColor: "#2a1332",
  },

  seo: {
    /** Blank means "use the application name and tagline". */
    metaTitle: "",
    titleSuffix: "",
    metaDescription: "",
    keywords: [
      "tutoring", "Canadian tutors", "Ontario curriculum", "MHF4U tutor",
      "online tutoring Canada", "in-person tutoring", "math tutor", "English tutor",
    ],
    ogTitle: "",
    ogDescription: "",
    twitterHandle: "",
    /** Overrides NEXT_PUBLIC_APP_URL for canonicals when an operator sets it. */
    canonicalBaseUrl: "",
    /** Turned off on a staging deployment that must not be indexed. */
    allowIndexing: true,
  },

  contact: {
    supportEmail: SITE.supportEmail,
    contactEmail: SITE.contactEmail,
    supportPhone: SITE.supportPhone,
    addressLine: "",
    city: "Toronto",
    province: "ON",
    postalCode: "",
    websiteUrl: "",
    businessHours: "Mon to Fri, 9am – 6pm ET",
    supportHours: SITE.supportHours,
  },

  social: { ...SITE.social },

  footer: {
    description: "",
    copyrightText: "",
    showSocial: true,
    showNewsletter: true,
    showAppBadges: true,
  },

  features: {
    messaging: true,
    favourites: true,
    tutorRequests: true,
    reviews: true,
    onlineLessons: true,
    inPersonLessons: true,
    googleSignIn: true,
    appleSignIn: true,
  },

  notifications: {
    /** Master switch for everything except security mail. */
    emailEnabled: true,
    bookingEmails: true,
    applicationEmails: true,
    reviewEmails: true,
    payoutEmails: true,
    announcementEmails: true,
  },
};

/**
 * Settings groups that are objects rather than scalars. `getSettings()` merges
 * these one level deep so a stored partial group cannot drop the defaults for
 * the keys it does not mention (§19).
 */
export const SETTINGS_GROUPS = [
  "branding", "theme", "seo", "contact", "social", "footer", "features", "notifications",
];

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

/**
 * Course browse (§13).
 *
 * Grade stages are expressed as `gradeLevel` ranges rather than a join onto
 * `Grade.stage`, because courses carry the denormalised level already — so the
 * stage filter costs no extra lookup and works for provinces whose grades
 * haven't been loaded yet.
 */
export const GRADE_STAGES = [
  { value: "ELEMENTARY", label: "Elementary", hint: "K–6", minLevel: 0, maxLevel: 6 },
  { value: "MIDDLE", label: "Middle school", hint: "Grades 7–8", minLevel: 7, maxLevel: 8 },
  { value: "SECONDARY", label: "Secondary", hint: "Grades 9–12", minLevel: 9, maxLevel: 12 },
];

export const GRADE_STAGE_LABELS = Object.fromEntries(
  GRADE_STAGES.map((stage) => [stage.value, stage.label]),
);

export const COURSE_SORT_OPTIONS = [
  { value: "RELEVANCE", label: "Best match" },
  { value: "TUTORS", label: "Most tutors" },
  { value: "GRADE_DESC", label: "Grade: high to low" },
  { value: "GRADE_ASC", label: "Grade: low to high" },
  { value: "NAME", label: "Course name (A–Z)" },
  { value: "CODE", label: "Course code (A–Z)" },
];

export const COURSE_SORTS = COURSE_SORT_OPTIONS.map((option) => option.value);
