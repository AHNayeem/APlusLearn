/**
 * Platform defaults. Anything an administrator can change at runtime lives in
 * the Settings collection and falls back to these values (§20, §26).
 *
 * `SITE` is the compile-time identity: the values a request uses when the
 * database has not been reached yet, or has nothing stored. Runtime code
 * should read `getAppConfig()` from the settings service instead of importing
 * `SITE` directly — this object is the floor beneath it, not the source.
 */

import { MATCH_WEIGHTS } from "../lib/matching/weights.js";

export const SITE = {
  name: "APlus Learn",
  shortName: "APlus",
  tagline: "Canada's trusted tutoring marketplace",
  description:
    "Find verified Canadian tutors for your child's exact course — online or in person. Compare, message and book lessons with transparent pricing.",
  supportEmail: "support@apluslearn.ca",
  contactEmail: "hello@apluslearn.ca",
  supportPhone: "1-888-555-0142",
  /**
   * WhatsApp business number, digits only with the country code (§26b).
   *
   * Blank by design, and it is the switch as well as the value: the floating
   * support launcher renders no WhatsApp button until an operator sets one, so
   * a fresh deployment cannot send a family to a `wa.me` link that belongs to
   * a stranger. `supportPhone` is deliberately not reused for it — a landline
   * is not a WhatsApp account.
   */
  whatsappNumber: "",
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
 * A person's own profile photo, and the rules it is held to (§8, §16).
 *
 * Shaped exactly like a branding asset so `validateImage` checks it with the
 * same header walk and the same refusals — an avatar is not a special kind of
 * upload, it is the same kind with different bounds, and a second validator
 * would be a second place for the SVG rule to be forgotten.
 *
 * Not `square`: people upload the photo they have, and every place the avatar
 * is drawn crops it to a circle with `object-cover`. Refusing a portrait would
 * be a rule the product does not need.
 *
 * 3 MB is roughly a phone photo straight from the camera roll. The pixel
 * ceiling is what stops that same phone's 12 MP panorama from being stored
 * whole and re-sent on every page that lists a name.
 */
export const AVATAR_IMAGE = {
  key: "avatar",
  label: "Profile photo",
  hint: "A clear head-and-shoulders photo. JPG, PNG or WebP.",
  accepts: ["image/png", "image/jpeg", "image/webp"],
  maxBytes: 3 * 1024 * 1024,
  minWidth: 64,
  minHeight: 64,
  maxWidth: 4096,
  maxHeight: 4096,
};

/**
 * The image hosts `next/image` is configured to fetch from.
 *
 * `next.config.mjs` builds its `remotePatterns` from this list, and
 * `renderableImageSrc()` checks against the same one, so the optimizer's
 * allow-list and the UI's idea of a usable photo cannot drift apart.
 *
 * Why it must not drift: a `src` on an unlisted host is not a broken image
 * that quietly falls back — `next/image` throws `Invalid src prop`, which
 * takes the whole surrounding render down. Profile photos and the tutor
 * gallery are free-text URLs on records users control, so an unlisted host
 * is an ordinary thing to find in the data, not an exotic one.
 */
export const REMOTE_IMAGE_HOSTS = [
  "images.unsplash.com",
  "lh3.googleusercontent.com",
  "avatars.githubusercontent.com",
];

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

  /**
   * Tutor requests and matching (§22, §41 Phase 2).
   *
   * §41 names "advanced matching" without defining its factors or their
   * relative importance, so the numbers live here where an operator owns
   * them rather than being frozen into the code. `matchWeights` is relative:
   * the scorer rescales whatever is stored onto a total of 100, so a score
   * is always on the same ruler however these are edited.
   */
  matching: {
    /** Below this, a suggestion is not worth showing anyone. 0–100. */
    minimumScore: 25,
    /** Ceiling on stored suggestions per request. */
    maxSuggestions: 20,
    /** How many of the strongest candidates get told a request exists. */
    notifyTopTutors: 8,
    /** How long a request stays open before the expiry job closes it. */
    requestTtlDays: 30,
    /** Days before expiry that the family is warned once. */
    requestExpiryWarningDays: 3,
    /** Open requests one learner account may hold at a time. */
    maxOpenRequestsPerOwner: 10,
    /** How many tutors a family may invite to one request. */
    maxInvitesPerRequest: 10,
  },

  matchWeights: { ...MATCH_WEIGHTS },

  /**
   * Tutor packages (§41 Phase 2).
   *
   * §41 names "tutor packages" and defines no pricing, discount or expiry
   * policy, so what is fixed here is only what keeps the product honest, and
   * the rest is the operator's:
   *
   *   A package may never cost more per hour than booking the same lessons
   *   one at a time — that is checked against the tutor's own rate, not a
   *   number invented here. A "package" that is a markup is a trap.
   *
   *   `expiryRefundPercent` ships at 100: nothing is kept for lessons that
   *   were never delivered. An operator who wants a stricter forfeiture rule
   *   has to choose it deliberately.
   */
  packages: {
    enabled: true,
    /** Lessons one package may contain. */
    minSessions: 2,
    maxSessions: 50,
    /** How long a purchase stays usable, unless the tutor sets its own. */
    defaultValidityDays: 180,
    maxValidityDays: 730,
    /** Packages one tutor may have on sale at once. */
    maxActivePerTutor: 10,
    /** Refunded share of unused lessons when a purchase expires unused. */
    expiryRefundPercent: 100,
    /** Days before expiry that the family is warned once. */
    expiryWarningDays: 14,
  },

  /**
   * Group tutoring (§41 Phase 2).
   *
   * §41 names group tutoring and sets no numbers, so what is fixed here is
   * the shape that keeps it fair and the rest is the operator's.
   *
   * `underMinimumRefundPercent` ships at 100 and is not meaningfully
   * negotiable: a session that does not run because too few people signed up
   * is nobody's fault but the platform's optimism, and keeping money for a
   * lesson that never happened would be indefensible.
   */
  groups: {
    enabled: true,
    minParticipants: 2,
    maxParticipants: 12,
    /** Hours before the start by which the minimum must be met. */
    confirmationDeadlineHours: 24,
    /** Refunded share when a session is cancelled for being under-subscribed. */
    underMinimumRefundPercent: 100,
    /** Learners who may wait for a seat, beyond the ones who have them. */
    maxWaitlist: 10,
    /** Sessions one tutor may have open for sign-ups at once. */
    maxOpenPerTutor: 20,
  },

  /**
   * Fraud and risk (§41 Phase 2).
   *
   * §41 names "fraud/risk tools" and defines no signal, threshold, score or
   * penalty whatsoever, so every number here belongs to the operator and the
   * shipped values are deliberately cautious — a false positive costs a real
   * family a real lesson.
   *
   * Two things are *not* settings, because there is no defensible value for
   * them:
   *
   *   Nothing is ever restricted automatically. A case is opened and an
   *   administrator decides. There is no "auto-suspend at score N" switch,
   *   because the requirements authorise no penalty at all and a platform
   *   that invents one is a platform that suspends somebody by arithmetic.
   *
   *   Every signal counts the same. Weighting a dispute above a declined card
   *   would be a risk model nobody specified. The score is simply how many
   *   distinct kinds of trouble fired inside the window, which is a number an
   *   administrator can check by reading the case.
   *
   * Cancellation abuse deliberately has no threshold here: it already has one
   * in `cancellationAbuseThreshold` above, and a second copy would drift.
   */
  risk: {
    enabled: true,
    /** How far back a signal still counts toward the current picture. */
    signalWindowDays: 30,
    /** Distinct signals before a case is opened for review at all. */
    reviewScore: 2,
    /** Distinct signals at which a case is called HIGH. */
    highScore: 4,
    /** Unattended lessons inside the window before the signal fires. */
    noShowThreshold: 3,
    /** Declined payments inside the window before the signal fires. */
    paymentFailureThreshold: 3,
    /** Disputes raised *against* an account before the signal fires. */
    disputeThreshold: 2,
  },

  /**
   * Promoted tutor profiles (§41 Phase 2).
   *
   * §41 names "promoted profiles" and defines no placement count, duration,
   * price or eligibility rule beyond the marketplace's own, so the only
   * numbers fixed here are the ones that keep discovery honest, and they are
   * the operator's to change:
   *
   *   A promotion moves a tutor up the *default* ordering only. When a
   *   visitor has asked for a specific order — cheapest first, closest
   *   first, highest rated — that is an instruction, and a paid placement
   *   that quietly overrode it would make the sort control a lie. That rule
   *   is not a setting, because there is no defensible value for "ignore
   *   what the visitor asked for".
   *
   *   `maxPromotedPerSearch` is the fairness ceiling: however many
   *   promotions are running, only this many results are ever moved up in one
   *   result set, so page one cannot become an advertisement board. It ships
   *   at 3 out of a 12-result page — a quarter, visible but not dominant.
   *
   *   Promoted results are always labelled in the UI. That is not negotiable
   *   either: undisclosed paid placement is an advertising-standards problem,
   *   not a design preference.
   */
  promotions: {
    enabled: true,
    /** Results moved up in any one result set. The fairness ceiling. */
    maxPromotedPerSearch: 3,
    /** Promotions that may run at the same moment across the marketplace. */
    maxActive: 20,
    /** Window length when an administrator does not name an end date. */
    defaultDurationDays: 30,
    /** Longest window an administrator may set in one go. */
    maxDurationDays: 365,
  },

  /**
   * Referrals (§41 Phase 2).
   *
   * §41 names "referrals" and defines no reward, so the amounts ship at zero
   * and belong to the operator. At zero the system is still fully live —
   * codes work, attribution is recorded, referrals qualify, both parties are
   * notified and administrators can review them — it simply grants no money
   * until somebody decides what a referral is worth.
   *
   * Credit is funded by the platform, not the tutor: a tutor is paid their
   * full earnings on a discounted booking, and the platform's commission
   * absorbs the difference. The alternative would make one tutor pay for
   * another party's marketing, which is not a rule anybody agreed to.
   */
  referrals: {
    enabled: true,
    /** Credit granted to the person who shared the code. */
    referrerRewardCents: 0,
    /** Credit granted to the person who used it. */
    refereeRewardCents: 0,
    /** Completed, paid lessons before a referral qualifies. */
    qualifyingLessons: 1,
    /** Days a granted credit stays usable. 0 means it never expires. */
    rewardExpiryDays: 365,
    /** Rewarded referrals one account may earn in a rolling year. */
    maxRewardsPerReferrer: 25,
  },

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
    whatsappNumber: SITE.whatsappNumber,
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

    /**
     * Text messages (§28, §41 Phase 2).
     *
     * `smsEnabled` is the platform switch; a person still has to confirm a
     * mobile number and turn the channel on for themselves before anything is
     * sent. Off by default, because a deployment with no carrier behind it
     * should not look as though it has one.
     */
    smsEnabled: false,
    /** Ceiling per number per hour. Guards both cost and nuisance. */
    smsPerNumberHourlyLimit: 5,
  },
};

/**
 * Settings groups that are objects rather than scalars. `getSettings()` merges
 * these one level deep so a stored partial group cannot drop the defaults for
 * the keys it does not mention (§19).
 */
export const SETTINGS_GROUPS = [
  "branding", "theme", "seo", "contact", "social", "footer", "features", "notifications",
  "matching", "matchWeights", "referrals", "packages", "groups", "promotions", "risk",
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

  /**
   * Shared files — message attachments and the homework a tutor attaches to a
   * progress report (§21, §41 Phase 3).
   *
   * The accepted types are deliberately the *same four* a verification
   * document may be, and for the same reason: `inspectDocument()` decides the
   * format by reading the bytes, and it can only vouch for formats it can
   * actually recognise. Accepting a .docx here would mean accepting a ZIP
   * whose contents nothing in this application has looked at, so the list
   * stops where the verification stops. A worksheet is a PDF or a photo.
   *
   * The per-parent caps are what keep one upload from becoming a hundred:
   * every attachment is a stored object somebody else can ask us to stream
   * back, so the count is bounded at the write, not at the read.
   */
  maxAttachmentBytes: 10 * 1024 * 1024,
  acceptedAttachmentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  maxAttachmentsPerMessage: 4,
  maxAttachmentsPerReport: 6,
  /**
   * Where file storage writes when no object store is configured (§16, §38).
   *
   * Outside `public/` so nothing here is ever served directly, outside `src/`
   * so nothing here is ever committed, and named here rather than in the
   * provider so the boot report can say where files are going without
   * importing the resolver that decrypts credentials.
   * `STORAGE_LOCAL_DIR` overrides it.
   */
  localStorageDir: ".storage",
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
