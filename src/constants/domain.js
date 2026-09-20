/**
 * Domain enums and marketplace vocabulary.
 * Kept in one place so models, validation, services and UI never drift apart.
 */

export const USER_STATUS = {
  ACTIVE: "ACTIVE",
  PENDING_VERIFICATION: "PENDING_VERIFICATION",
  SUSPENDED: "SUSPENDED",
  DELETED: "DELETED",
};

export const AUTH_PROVIDERS = {
  CREDENTIALS: "CREDENTIALS",
  GOOGLE: "GOOGLE",
  APPLE: "APPLE",
};

/** Tutor profile lifecycle. Only APPROVED profiles are searchable (§42). */
export const TUTOR_STATUS = {
  DRAFT: "DRAFT",
  PENDING_REVIEW: "PENDING_REVIEW",
  INFO_REQUESTED: "INFO_REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
};

export const TUTOR_STATUS_LABELS = {
  DRAFT: "Draft",
  PENDING_REVIEW: "Pending review",
  INFO_REQUESTED: "More information requested",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

export const VERIFICATION_TYPES = {
  IDENTITY: "IDENTITY",
  OCT: "OCT",
  EDUCATION: "EDUCATION",
  UNIVERSITY_STUDENT: "UNIVERSITY_STUDENT",
  BACKGROUND_CHECK: "BACKGROUND_CHECK",
};

export const VERIFICATION_LABELS = {
  IDENTITY: "Identity Verified",
  OCT: "OCT Verified",
  EDUCATION: "Education Verified",
  UNIVERSITY_STUDENT: "University Student Verified",
  BACKGROUND_CHECK: "Background Check Verified",
};

export const VERIFICATION_DESCRIPTIONS = {
  IDENTITY:
    "Government-issued photo ID checked against the name on the tutor's account.",
  OCT: "Membership with the Ontario College of Teachers confirmed in the public register.",
  EDUCATION: "Degrees and diplomas confirmed against official transcripts.",
  UNIVERSITY_STUDENT:
    "Current enrolment confirmed through an institutional email or enrolment letter.",
  BACKGROUND_CHECK:
    "Vulnerable Sector Check reviewed and dated within the last 12 months.",
};

export const VERIFICATION_STATUS = {
  NOT_SUBMITTED: "NOT_SUBMITTED",
  PENDING: "PENDING",
  INFO_REQUESTED: "INFO_REQUESTED",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
};

export const LESSON_MODES = {
  ONLINE: "ONLINE",
  IN_PERSON: "IN_PERSON",
};

export const LESSON_MODE_LABELS = {
  ONLINE: "Online",
  IN_PERSON: "In person",
};

export const MEETING_PROVIDERS = {
  ZOOM: "ZOOM",
  GOOGLE_MEET: "GOOGLE_MEET",
  MICROSOFT_TEAMS: "MICROSOFT_TEAMS",
};

export const MEETING_PROVIDER_LABELS = {
  ZOOM: "Zoom",
  GOOGLE_MEET: "Google Meet",
  MICROSOFT_TEAMS: "Microsoft Teams",
};

export const IN_PERSON_LOCATIONS = {
  STUDENT_HOME: "STUDENT_HOME",
  TUTOR_LOCATION: "TUTOR_LOCATION",
  LIBRARY: "LIBRARY",
  PUBLIC_PLACE: "PUBLIC_PLACE",
  OTHER: "OTHER",
};

export const IN_PERSON_LOCATION_LABELS = {
  STUDENT_HOME: "Student's home",
  TUTOR_LOCATION: "Tutor's location",
  LIBRARY: "Public library",
  PUBLIC_PLACE: "Public place",
  OTHER: "Other agreed location",
};

export const BOOKING_STATUS = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  CONFIRMED: "CONFIRMED",
  COMPLETED: "COMPLETED",
  CANCELLED_BY_STUDENT: "CANCELLED_BY_STUDENT",
  CANCELLED_BY_TUTOR: "CANCELLED_BY_TUTOR",
  CANCELLED_BY_ADMIN: "CANCELLED_BY_ADMIN",
  NO_SHOW_STUDENT: "NO_SHOW_STUDENT",
  NO_SHOW_TUTOR: "NO_SHOW_TUTOR",
  DISPUTED: "DISPUTED",
  /**
   * Checkout was never completed and the slot has been given back (§19).
   * Terminal: nothing transitions out of it, and it is deliberately absent
   * from BLOCKING_BOOKING_STATUSES below.
   */
  EXPIRED: "EXPIRED",
};

export const BOOKING_STATUS_LABELS = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED_BY_STUDENT: "Cancelled by student",
  CANCELLED_BY_TUTOR: "Cancelled by tutor",
  CANCELLED_BY_ADMIN: "Cancelled by APlus Learn",
  NO_SHOW_STUDENT: "Student no-show",
  NO_SHOW_TUTOR: "Tutor no-show",
  DISPUTED: "Under dispute",
  EXPIRED: "Payment not completed",
};

export const CANCELLED_STATUSES = [
  BOOKING_STATUS.CANCELLED_BY_STUDENT,
  BOOKING_STATUS.CANCELLED_BY_TUTOR,
  BOOKING_STATUS.CANCELLED_BY_ADMIN,
];

/**
 * Statuses that still occupy a slot on the tutor's calendar.
 *
 * PENDING_PAYMENT is here because an unpaid booking must hold its slot while
 * the purchaser is at the checkout page — but only for as long as the hold
 * lasts. `CHECKOUT_HOLD` in constants/config.js sets that window, and the
 * `booking-expiry` job moves anything past it to EXPIRED, which is *not* in
 * this list. Without that job, an abandoned checkout would remove a tutor's
 * availability permanently.
 */
export const BLOCKING_BOOKING_STATUSES = [
  BOOKING_STATUS.PENDING_PAYMENT,
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.NO_SHOW_STUDENT,
  BOOKING_STATUS.NO_SHOW_TUTOR,
  BOOKING_STATUS.DISPUTED,
];

export const PAYMENT_STATUS = {
  REQUIRES_PAYMENT: "REQUIRES_PAYMENT",
  PROCESSING: "PROCESSING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
};

export const PAYMENT_STATUS_LABELS = {
  REQUIRES_PAYMENT: "Awaiting payment",
  PROCESSING: "Processing",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

export const PAYOUT_STATUS = {
  PENDING: "PENDING",
  SCHEDULED: "SCHEDULED",
  IN_TRANSIT: "IN_TRANSIT",
  PAID: "PAID",
  FAILED: "FAILED",
};

export const PAYOUT_STATUS_LABELS = {
  PENDING: "Pending",
  SCHEDULED: "Scheduled",
  IN_TRANSIT: "In transit",
  PAID: "Paid",
  FAILED: "Failed",
};

/**
 * Tutor request lifecycle (§22, §41 Phase 2).
 *
 * OPEN is the only status that gains new matches or accepts tutor responses.
 * The three endings are kept apart because they mean different things to the
 * marketplace: MATCHED is a success, CANCELLED is the family changing their
 * mind, EXPIRED is time running out, and REMOVED is a moderator's decision.
 */
export const REQUEST_STATUS = {
  OPEN: "OPEN",
  MATCHED: "MATCHED",
  CLOSED: "CLOSED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  REMOVED: "REMOVED",
};

export const REQUEST_STATUS_LABELS = {
  OPEN: "Open",
  MATCHED: "Matched",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  REMOVED: "Removed by APlus Learn",
};

/** Statuses in which a request is finished and cannot be reopened. */
export const CLOSED_REQUEST_STATUSES = [
  REQUEST_STATUS.MATCHED,
  REQUEST_STATUS.CLOSED,
  REQUEST_STATUS.CANCELLED,
  REQUEST_STATUS.EXPIRED,
  REQUEST_STATUS.REMOVED,
];

/** How soon the family wants to start. Affects ordering, never eligibility. */
export const REQUEST_URGENCY = {
  FLEXIBLE: "FLEXIBLE",
  THIS_MONTH: "THIS_MONTH",
  THIS_WEEK: "THIS_WEEK",
  URGENT: "URGENT",
};

export const REQUEST_URGENCY_LABELS = {
  FLEXIBLE: "No rush",
  THIS_MONTH: "Within a month",
  THIS_WEEK: "Within a week",
  URGENT: "As soon as possible",
};

/**
 * Who may see a request.
 *
 * PUBLIC is listed to every approved tutor who teaches the subject.
 * INVITE_ONLY is visible only to tutors the family invited by name — the
 * request never appears in the open board, and an uninvited tutor cannot
 * respond to it. Enforced in the service, not by hiding a list (§10).
 */
export const REQUEST_VISIBILITY = {
  PUBLIC: "PUBLIC",
  INVITE_ONLY: "INVITE_ONLY",
};

export const REQUEST_VISIBILITY_LABELS = {
  PUBLIC: "Open to all matching tutors",
  INVITE_ONLY: "Only tutors I invite",
};

/**
 * A tutor's relationship to a request.
 *
 * Owner-driven: INVITED, SHORTLISTED, DECLINED, BOOKED.
 * Tutor-driven: TUTOR_INTERESTED, TUTOR_DECLINED, WITHDRAWN.
 * SUGGESTED is the matcher's own, and means nobody has acted yet.
 */
export const MATCH_STATUS = {
  SUGGESTED: "SUGGESTED",
  INVITED: "INVITED",
  TUTOR_INTERESTED: "TUTOR_INTERESTED",
  TUTOR_DECLINED: "TUTOR_DECLINED",
  WITHDRAWN: "WITHDRAWN",
  SHORTLISTED: "SHORTLISTED",
  DECLINED: "DECLINED",
  BOOKED: "BOOKED",
};

export const MATCH_STATUS_LABELS = {
  SUGGESTED: "Suggested",
  INVITED: "Invited",
  TUTOR_INTERESTED: "Interested",
  TUTOR_DECLINED: "Tutor declined",
  WITHDRAWN: "Withdrawn",
  SHORTLISTED: "Shortlisted",
  DECLINED: "Not a fit",
  BOOKED: "Booked",
};

/** Match states a tutor has closed off; the matcher never revives one. */
export const TUTOR_CLOSED_MATCH_STATUSES = [
  MATCH_STATUS.TUTOR_DECLINED,
  MATCH_STATUS.WITHDRAWN,
];

export const REVIEW_STATUS = {
  PUBLISHED: "PUBLISHED",
  PENDING_MODERATION: "PENDING_MODERATION",
  REPORTED: "REPORTED",
  REMOVED: "REMOVED",
};

/**
 * Lifecycle of a *report* — a user asking a moderator to look at something.
 *
 * Deliberately separate from the visibility status of the thing reported:
 * reporting opens a case, it does not decide the outcome. Only a moderator
 * changes what the public sees (§21, §23).
 */
export const REPORT_STATUS = {
  OPEN: "OPEN",
  REVIEWING: "REVIEWING",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED",
};

export const REPORT_STATUS_LABELS = {
  OPEN: "Open",
  REVIEWING: "Under review",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

/** Reports a moderator has not finished with. */
export const ACTIVE_REPORT_STATUSES = [REPORT_STATUS.OPEN, REPORT_STATUS.REVIEWING];

export const DISPUTE_STATUS = {
  OPEN: "OPEN",
  UNDER_REVIEW: "UNDER_REVIEW",
  RESOLVED_REFUND: "RESOLVED_REFUND",
  RESOLVED_PARTIAL_REFUND: "RESOLVED_PARTIAL_REFUND",
  RESOLVED_NO_REFUND: "RESOLVED_NO_REFUND",
  REJECTED: "REJECTED",
};

export const DISPUTE_STATUS_LABELS = {
  OPEN: "Open",
  UNDER_REVIEW: "Under review",
  RESOLVED_REFUND: "Resolved — full refund",
  RESOLVED_PARTIAL_REFUND: "Resolved — partial refund",
  RESOLVED_NO_REFUND: "Resolved — no refund",
  REJECTED: "Rejected",
};

export const DISPUTE_REASONS = {
  TUTOR_NO_SHOW: "TUTOR_NO_SHOW",
  STUDENT_NO_SHOW: "STUDENT_NO_SHOW",
  LESSON_QUALITY: "LESSON_QUALITY",
  BILLING: "BILLING",
  CONDUCT: "CONDUCT",
  OTHER: "OTHER",
};

export const DISPUTE_REASON_LABELS = {
  TUTOR_NO_SHOW: "Tutor did not attend",
  STUDENT_NO_SHOW: "Student did not attend",
  LESSON_QUALITY: "Lesson quality concern",
  BILLING: "Billing problem",
  CONDUCT: "Conduct concern",
  OTHER: "Something else",
};

export const NOTIFICATION_TYPES = {
  BOOKING_CREATED: "BOOKING_CREATED",
  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_CHANGED: "BOOKING_CHANGED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_REMINDER: "BOOKING_REMINDER",
  BOOKING_COMPLETED: "BOOKING_COMPLETED",
  BOOKING_EXPIRED: "BOOKING_EXPIRED",
  REFUND_ISSUED: "REFUND_ISSUED",
  APPLICATION_SUBMITTED: "APPLICATION_SUBMITTED",
  APPLICATION_APPROVED: "APPLICATION_APPROVED",
  APPLICATION_REJECTED: "APPLICATION_REJECTED",
  APPLICATION_INFO_REQUESTED: "APPLICATION_INFO_REQUESTED",
  VERIFICATION_UPDATED: "VERIFICATION_UPDATED",
  MESSAGE_RECEIVED: "MESSAGE_RECEIVED",
  REQUEST_INTEREST: "REQUEST_INTEREST",
  REQUEST_MATCHED: "REQUEST_MATCHED",
  REQUEST_INVITED: "REQUEST_INVITED",
  PROGRESS_REPORT_SHARED: "PROGRESS_REPORT_SHARED",
  REFERRAL_JOINED: "REFERRAL_JOINED",
  PACKAGE_PURCHASED: "PACKAGE_PURCHASED",
  GROUP_SESSION_JOINED: "GROUP_SESSION_JOINED",
  GROUP_SESSION_CONFIRMED: "GROUP_SESSION_CONFIRMED",
  GROUP_SESSION_CANCELLED: "GROUP_SESSION_CANCELLED",
  GROUP_SEAT_AVAILABLE: "GROUP_SEAT_AVAILABLE",
  PACKAGE_LOW_BALANCE: "PACKAGE_LOW_BALANCE",
  PACKAGE_EXPIRING: "PACKAGE_EXPIRING",
  PACKAGE_EXPIRED: "PACKAGE_EXPIRED",
  REFERRAL_REWARDED: "REFERRAL_REWARDED",
  CREDIT_GRANTED: "CREDIT_GRANTED",
  PROGRESS_REPORT_UPDATED: "PROGRESS_REPORT_UPDATED",
  REQUEST_UPDATED: "REQUEST_UPDATED",
  REQUEST_EXPIRING: "REQUEST_EXPIRING",
  REQUEST_CLOSED: "REQUEST_CLOSED",
  PAYOUT_UPDATED: "PAYOUT_UPDATED",
  REVIEW_RECEIVED: "REVIEW_RECEIVED",
  DISPUTE_UPDATED: "DISPUTE_UPDATED",
  PROFILE_PROMOTED: "PROFILE_PROMOTED",
  ACCOUNT_UNDER_REVIEW: "ACCOUNT_UNDER_REVIEW",
};

export const NOTIFICATION_CHANNELS = {
  IN_APP: "IN_APP",
  EMAIL: "EMAIL",
  SMS: "SMS",
  PUSH: "PUSH",
};

/**
 * What happened to one outgoing text message (§28, §41 Phase 2).
 *
 * SIMULATED is its own status and is never conflated with SENT: it means the
 * development provider recorded a message that no carrier ever saw. A record
 * in that state is evidence the pipeline ran, not evidence anyone was texted.
 */
export const SMS_STATUS = {
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  SIMULATED: "SIMULATED",
  SKIPPED: "SKIPPED",
};

export const SMS_STATUS_LABELS = {
  QUEUED: "Queued",
  SENT: "Sent",
  DELIVERED: "Delivered",
  FAILED: "Failed",
  SIMULATED: "Simulated (no provider configured)",
  SKIPPED: "Not sent",
};

/** Why a text was not sent. Recorded so "no SMS" is always explainable. */
export const SMS_SKIP_REASONS = {
  NO_PHONE: "NO_PHONE",
  PHONE_UNVERIFIED: "PHONE_UNVERIFIED",
  CHANNEL_DISABLED: "CHANNEL_DISABLED",
  OPTED_OUT: "OPTED_OUT",
  PLATFORM_DISABLED: "PLATFORM_DISABLED",
  NO_TEMPLATE: "NO_TEMPLATE",
  RATE_LIMITED: "RATE_LIMITED",
  DUPLICATE: "DUPLICATE",
};

export const SMS_SKIP_REASON_LABELS = {
  NO_PHONE: "No mobile number on the account",
  PHONE_UNVERIFIED: "Mobile number not confirmed",
  CHANNEL_DISABLED: "Text messages switched off by the recipient",
  OPTED_OUT: "Recipient replied STOP",
  PLATFORM_DISABLED: "Text messages switched off platform-wide",
  NO_TEMPLATE: "No text version of this notification",
  RATE_LIMITED: "Too many texts to this number",
  DUPLICATE: "Already sent",
};

/** Keywords a carrier forwards verbatim. Honouring them is a legal duty. */
export const SMS_OPT_OUT_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
export const SMS_OPT_IN_KEYWORDS = ["START", "YES", "UNSTOP"];

/**
 * External calendars a tutor can connect (§18, §41 Phase 2).
 *
 * The values match what `Availability.externalCalendars` has always declared,
 * so a profile written by the MVP build needs no migration.
 */
export const CALENDAR_PROVIDERS = {
  GOOGLE: "GOOGLE",
  OUTLOOK: "OUTLOOK",
};

export const CALENDAR_PROVIDER_LABELS = {
  GOOGLE: "Google Calendar",
  OUTLOOK: "Outlook Calendar",
};

/**
 * State of one connection.
 *
 * NEEDS_RECONSENT is distinct from REVOKED: the first means our refresh token
 * stopped working and the person can fix it by reconnecting, the second means
 * they deliberately disconnected. Showing "reconnect" for the one and nothing
 * for the other is the difference between a helpful prompt and nagging.
 */
export const CALENDAR_CONNECTION_STATUS = {
  CONNECTED: "CONNECTED",
  NEEDS_RECONSENT: "NEEDS_RECONSENT",
  REVOKED: "REVOKED",
};

export const CALENDAR_CONNECTION_STATUS_LABELS = {
  CONNECTED: "Connected",
  NEEDS_RECONSENT: "Reconnect needed",
  REVOKED: "Disconnected",
};

/** What a booking's calendar event is doing on the external calendar. */
export const CALENDAR_EVENT_STATE = {
  PENDING: "PENDING",
  SYNCED: "SYNCED",
  FAILED: "FAILED",
  DELETED: "DELETED",
};

/**
 * Student progress reports (§41 Phase 2).
 *
 * DRAFT is the tutor's own workspace and nobody else can see it. SUBMITTED is
 * the moment it becomes part of the learner's record — from then on it is
 * edited by revision rather than by overwrite, because a family reading a
 * report next term should see what was actually said at the time.
 */
export const PROGRESS_REPORT_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  ARCHIVED: "ARCHIVED",
};

export const PROGRESS_REPORT_STATUS_LABELS = {
  DRAFT: "Draft",
  SUBMITTED: "Shared with the family",
  ARCHIVED: "Archived",
};

/** The short scales a tutor rates each period against. */
export const PROGRESS_RATINGS = {
  UNDERSTANDING: "understanding",
  EFFORT: "effort",
  PARTICIPATION: "participation",
  HOMEWORK: "homework",
};

export const PROGRESS_RATING_LABELS = {
  understanding: "Understanding",
  effort: "Effort",
  participation: "Participation",
  homework: "Homework completion",
};

export const PROGRESS_RATING_SCALE = [
  { value: 1, label: "Needs significant support" },
  { value: 2, label: "Developing" },
  { value: 3, label: "Meeting expectations" },
  { value: 4, label: "Strong" },
  { value: 5, label: "Excellent" },
];

/** Where a learning goal stands, as of one report. */
export const GOAL_PROGRESS = {
  NOT_STARTED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  ACHIEVED: "ACHIEVED",
  ON_HOLD: "ON_HOLD",
};

export const GOAL_PROGRESS_LABELS = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  ACHIEVED: "Achieved",
  ON_HOLD: "On hold",
};

/**
 * Referrals (§41 Phase 2).
 *
 * PENDING is an attribution and nothing more — somebody signed up with a
 * code. It becomes QUALIFIED only once the new account has actually paid for
 * and taken lessons, which is what stops a code being farmed by creating
 * accounts. REVERSED exists because a qualifying lesson can be refunded after
 * the reward was granted.
 */
export const REFERRAL_STATUS = {
  PENDING: "PENDING",
  QUALIFIED: "QUALIFIED",
  REWARDED: "REWARDED",
  REVERSED: "REVERSED",
  BLOCKED: "BLOCKED",
};

export const REFERRAL_STATUS_LABELS = {
  PENDING: "Signed up",
  QUALIFIED: "Lessons taken",
  REWARDED: "Reward paid",
  REVERSED: "Reversed",
  BLOCKED: "Blocked",
};

/**
 * Why a referral was flagged for a human to look at.
 *
 * Flags are recorded and surfaced to administrators; none of them
 * automatically punishes anybody. The requirements do not define penalties,
 * so the platform does not invent them — it makes the signal reviewable.
 */
export const REFERRAL_RISK_FLAGS = {
  SELF_REFERRAL: "SELF_REFERRAL",
  SHARED_PHONE: "SHARED_PHONE",
  RAPID_SIGNUPS: "RAPID_SIGNUPS",
  REWARD_CAP_REACHED: "REWARD_CAP_REACHED",
  REFERRER_INACTIVE: "REFERRER_INACTIVE",
};

export const REFERRAL_RISK_FLAG_LABELS = {
  SELF_REFERRAL: "Looks like the same person",
  SHARED_PHONE: "Same confirmed mobile number as the referrer",
  RAPID_SIGNUPS: "Several sign-ups from this code in a short window",
  REWARD_CAP_REACHED: "Referrer is at the reward cap",
  REFERRER_INACTIVE: "Referrer's account is not active",
};

/**
 * Movements on an account's credit balance (§41 Phase 2).
 *
 * The balance itself lives on the user record, where a single atomic update
 * makes it impossible to spend the same credit twice. This ledger is the
 * explanation of how it got there.
 */
export const CREDIT_REASONS = {
  REFERRAL_REWARD: "REFERRAL_REWARD",
  REFERRAL_WELCOME: "REFERRAL_WELCOME",
  SPEND: "SPEND",
  SPEND_RELEASED: "SPEND_RELEASED",
  REFERRAL_REVERSAL: "REFERRAL_REVERSAL",
  ADMIN_ADJUSTMENT: "ADMIN_ADJUSTMENT",
};

export const CREDIT_REASON_LABELS = {
  REFERRAL_REWARD: "Referral reward",
  REFERRAL_WELCOME: "Welcome credit",
  SPEND: "Applied to a booking",
  SPEND_RELEASED: "Returned from a booking",
  REFERRAL_REVERSAL: "Referral reversed",
  ADMIN_ADJUSTMENT: "Adjustment by APlus Learn",
};

/**
 * Tutor packages (§41 Phase 2).
 *
 * A package is an offer a tutor publishes: a block of lessons at a set price.
 * Buying one creates a `PackagePurchase`, which is the balance a family draws
 * lessons from. The two lifecycles are separate — archiving an offer must not
 * take away lessons somebody already paid for.
 */
export const PACKAGE_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED",
};

export const PACKAGE_STATUS_LABELS = {
  DRAFT: "Draft",
  ACTIVE: "On sale",
  PAUSED: "Paused",
  ARCHIVED: "Archived",
};

/** Offers a family can actually buy. */
export const PURCHASABLE_PACKAGE_STATUSES = [PACKAGE_STATUS.ACTIVE];

export const PACKAGE_PURCHASE_STATUS = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  ACTIVE: "ACTIVE",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

export const PACKAGE_PURCHASE_STATUS_LABELS = {
  PENDING_PAYMENT: "Awaiting payment",
  ACTIVE: "Active",
  COMPLETED: "All lessons used",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Purchases lessons can still be drawn from. */
export const USABLE_PACKAGE_STATUSES = [PACKAGE_PURCHASE_STATUS.ACTIVE];

/**
 * Group tutoring (§41 Phase 2).
 *
 * A group session is scheduled once by the tutor and joined by several
 * learners. It reserves the tutor's slot the moment it is published, which is
 * why DRAFT and PUBLISHED are different things: a draft holds nothing.
 *
 * CONFIRMED means the minimum number of learners has been reached and the
 * session is definitely running. Until then it is published and filling, and
 * an enrolment is a commitment that may still be given back in full.
 */
export const GROUP_SESSION_STATUS = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
};

export const GROUP_SESSION_STATUS_LABELS = {
  DRAFT: "Draft",
  PUBLISHED: "Open for sign-ups",
  CONFIRMED: "Going ahead",
  CANCELLED: "Cancelled",
  COMPLETED: "Finished",
};

/** Statuses in which a session is holding the tutor's time. */
export const ACTIVE_GROUP_STATUSES = [
  GROUP_SESSION_STATUS.PUBLISHED,
  GROUP_SESSION_STATUS.CONFIRMED,
  GROUP_SESSION_STATUS.COMPLETED,
];

/** Statuses a learner can still join. */
export const JOINABLE_GROUP_STATUSES = [
  GROUP_SESSION_STATUS.PUBLISHED,
  GROUP_SESSION_STATUS.CONFIRMED,
];

export const GROUP_ENROLMENT_STATUS = {
  PENDING_PAYMENT: "PENDING_PAYMENT",
  CONFIRMED: "CONFIRMED",
  WAITLISTED: "WAITLISTED",
  CANCELLED: "CANCELLED",
  REFUNDED: "REFUNDED",
};

export const GROUP_ENROLMENT_STATUS_LABELS = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  WAITLISTED: "On the waiting list",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/** Enrolments that occupy a seat. A waitlisted learner does not. */
export const SEAT_HOLDING_ENROLMENT_STATUSES = [
  GROUP_ENROLMENT_STATUS.PENDING_PAYMENT,
  GROUP_ENROLMENT_STATUS.CONFIRMED,
];

/**
 * Promoted tutor profiles (§41 Phase 2).
 *
 * A promotion is an administrator's decision to give an already-eligible
 * tutor a better position in discovery for a bounded window. It is never a
 * visibility grant: every promoted result is still drawn through the same
 * `isSearchable` gate and the same filters as an unpromoted one, so a
 * promotion can change *where* a tutor appears and never *whether* they do
 * (§42).
 *
 * SCHEDULED is a promotion that has been created but whose window has not
 * opened. PAUSED is an administrator stopping one early without destroying
 * the record. EXPIRED and CANCELLED are terminal, and a terminal promotion is
 * never reopened — an operator creates a new one, so the history of what ran
 * when stays readable.
 */
export const PROMOTION_STATUS = {
  SCHEDULED: "SCHEDULED",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
};

export const PROMOTION_STATUS_LABELS = {
  SCHEDULED: "Scheduled",
  ACTIVE: "Running",
  PAUSED: "Paused",
  EXPIRED: "Finished",
  CANCELLED: "Cancelled",
};

/**
 * Statuses a promotion can still move out of. One tutor may hold at most one
 * promotion in this set at a time, which is what stops two overlapping
 * windows from arguing about who is promoted.
 */
export const OPEN_PROMOTION_STATUSES = [
  PROMOTION_STATUS.SCHEDULED,
  PROMOTION_STATUS.ACTIVE,
  PROMOTION_STATUS.PAUSED,
];

/** Nothing moves out of these. */
export const TERMINAL_PROMOTION_STATUSES = [
  PROMOTION_STATUS.EXPIRED,
  PROMOTION_STATUS.CANCELLED,
];

/**
 * Fraud and risk (§41 Phase 2).
 *
 * The platform already detected several kinds of trouble before this existed
 * — repeated cancellations, referral abuse, disputes — and then did nothing
 * durable with any of it. A risk case is the missing piece: one record per
 * account, holding every signal that fired, so an administrator can see what
 * happened, why it was flagged, and what was decided.
 *
 * **Nothing here punishes anybody automatically.** The requirements name
 * "fraud/risk tools" and define no penalty, no threshold and no restriction,
 * so the platform detects and surfaces, and a person decides. The only
 * restriction the system can apply is the suspension an administrator was
 * always able to apply by hand — reached from a case, recorded on it, and
 * never triggered by a score.
 */
export const RISK_SIGNALS = {
  REPEATED_CANCELLATIONS: "REPEATED_CANCELLATIONS",
  NO_SHOW_PATTERN: "NO_SHOW_PATTERN",
  PAYMENT_FAILURES: "PAYMENT_FAILURES",
  REPEATED_DISPUTES: "REPEATED_DISPUTES",
  REFERRAL_ABUSE: "REFERRAL_ABUSE",
};

export const RISK_SIGNAL_LABELS = {
  REPEATED_CANCELLATIONS: "Repeated cancellations",
  NO_SHOW_PATTERN: "Pattern of not attending",
  PAYMENT_FAILURES: "Repeated payment failures",
  REPEATED_DISPUTES: "Several disputes raised against this account",
  REFERRAL_ABUSE: "Referral scheme abuse",
};

export const RISK_SIGNAL_DESCRIPTIONS = {
  REPEATED_CANCELLATIONS:
    "Cancelled more lessons inside the platform's rolling window than its cancellation-abuse threshold allows, twice over.",
  NO_SHOW_PATTERN: "Did not attend lessons that were paid for and confirmed.",
  PAYMENT_FAILURES:
    "Several payment attempts were declined, which can indicate a stolen or tested card.",
  REPEATED_DISPUTES: "Other people have opened disputes naming this account.",
  REFERRAL_ABUSE:
    "A referral this account was part of was flagged — shared numbers, or sign-ups faster than a person plausibly refers friends.",
};

/**
 * Case lifecycle.
 *
 * OPEN is "something fired and nobody has looked". UNDER_REVIEW is an
 * administrator taking it. CONFIRMED and CLEARED are both resolutions and
 * both terminal — the difference is what was concluded, which matters because
 * a cleared case is the evidence that an account was investigated and found
 * fine.
 */
export const RISK_CASE_STATUS = {
  OPEN: "OPEN",
  UNDER_REVIEW: "UNDER_REVIEW",
  CONFIRMED: "CONFIRMED",
  CLEARED: "CLEARED",
};

export const RISK_CASE_STATUS_LABELS = {
  OPEN: "Needs review",
  UNDER_REVIEW: "Being reviewed",
  CONFIRMED: "Confirmed",
  CLEARED: "Cleared",
};

/** Cases still needing a decision. One per account at a time. */
export const OPEN_RISK_CASE_STATUSES = [
  RISK_CASE_STATUS.OPEN,
  RISK_CASE_STATUS.UNDER_REVIEW,
];

export const RESOLVED_RISK_CASE_STATUSES = [
  RISK_CASE_STATUS.CONFIRMED,
  RISK_CASE_STATUS.CLEARED,
];

/**
 * How loud a case is.
 *
 * Derived from how many distinct signals fired inside the window, against
 * operator-set thresholds — never set by a client, and never by itself a
 * reason for the platform to act.
 */
export const RISK_LEVELS = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
};

export const RISK_LEVEL_LABELS = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

/**
 * What an administrator did about a case.
 *
 * `ACCOUNT_SUSPENDED` records that the existing suspension was applied; it is
 * not a second restriction mechanism, and the suspension itself still goes
 * through the ordinary user-management path with its own audit entry.
 */
export const RISK_ACTIONS = {
  NONE: "NONE",
  WARNING_ISSUED: "WARNING_ISSUED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
};

export const RISK_ACTION_LABELS = {
  NONE: "No action taken",
  WARNING_ISSUED: "Warning sent to the account",
  ACCOUNT_SUSPENDED: "Account suspended",
};

export const ATTENDANCE = {
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
};

export const ATTENDANCE_LABELS = {
  PRESENT: "Attended",
  ABSENT: "Did not attend",
};

export const DOCUMENT_STATUS = {
  UPLOADED: "UPLOADED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

/**
 * Lesson reminders (§28).
 *
 * `key` is what gets written to `Booking.remindersSent`, which is how the
 * scheduler stays idempotent: a reminder that has already been claimed is
 * never sent twice, however many times the job runs. Ordered furthest-out
 * first — the scheduler reads the first entry to size its query window.
 */
export const BOOKING_REMINDERS = [
  { key: "T24H", minutesBefore: 24 * 60, label: "tomorrow" },
  { key: "T1H", minutesBefore: 60, label: "in about an hour" },
];

/** Lesson durations we sell, in minutes. */
export const LESSON_DURATIONS = [30, 45, 60, 90, 120];

export const DEFAULT_LESSON_DURATION = 60;

export const WEEKDAYS = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
];

export const RECURRENCE = {
  NONE: "NONE",
  WEEKLY: "WEEKLY",
  BIWEEKLY: "BIWEEKLY",
};

export const RECURRENCE_LABELS = {
  NONE: "One-time lesson",
  WEEKLY: "Every week",
  BIWEEKLY: "Every two weeks",
};

export const QUALIFICATION_TYPES = {
  CERTIFIED_TEACHER: "CERTIFIED_TEACHER",
  OCT_MEMBER: "OCT_MEMBER",
  UNIVERSITY_STUDENT: "UNIVERSITY_STUDENT",
  GRADUATE: "GRADUATE",
  POSTGRADUATE: "POSTGRADUATE",
  SUBJECT_SPECIALIST: "SUBJECT_SPECIALIST",
};

export const QUALIFICATION_LABELS = {
  CERTIFIED_TEACHER: "Certified teacher",
  OCT_MEMBER: "Ontario College of Teachers member",
  UNIVERSITY_STUDENT: "University student",
  GRADUATE: "University graduate",
  POSTGRADUATE: "Postgraduate degree",
  SUBJECT_SPECIALIST: "Subject specialist",
};

export const AUDIT_ACTIONS = {
  RISK_SIGNAL_RECORDED: "RISK_SIGNAL_RECORDED",
  RISK_CASE_OPENED: "RISK_CASE_OPENED",
  RISK_CASE_REVIEWED: "RISK_CASE_REVIEWED",
  RISK_CASE_RESOLVED: "RISK_CASE_RESOLVED",
  PROMOTION_CREATED: "PROMOTION_CREATED",
  PROMOTION_ACTIVATED: "PROMOTION_ACTIVATED",
  PROMOTION_PAUSED: "PROMOTION_PAUSED",
  PROMOTION_EXTENDED: "PROMOTION_EXTENDED",
  PROMOTION_CANCELLED: "PROMOTION_CANCELLED",
  PROMOTION_EXPIRED: "PROMOTION_EXPIRED",
  GROUP_SESSION_PUBLISHED: "GROUP_SESSION_PUBLISHED",
  GROUP_SESSION_CANCELLED: "GROUP_SESSION_CANCELLED",
  GROUP_SESSION_COMPLETED: "GROUP_SESSION_COMPLETED",
  GROUP_ENROLMENT_CREATED: "GROUP_ENROLMENT_CREATED",
  GROUP_ENROLMENT_CANCELLED: "GROUP_ENROLMENT_CANCELLED",
  GROUP_ATTENDANCE_RECORDED: "GROUP_ATTENDANCE_RECORDED",
  PACKAGE_PUBLISHED: "PACKAGE_PUBLISHED",
  PACKAGE_ARCHIVED: "PACKAGE_ARCHIVED",
  PACKAGE_PURCHASED: "PACKAGE_PURCHASED",
  PACKAGE_SESSION_USED: "PACKAGE_SESSION_USED",
  PACKAGE_CANCELLED: "PACKAGE_CANCELLED",
  PACKAGE_EXPIRED: "PACKAGE_EXPIRED",
  REFERRAL_ATTRIBUTED: "REFERRAL_ATTRIBUTED",
  REFERRAL_QUALIFIED: "REFERRAL_QUALIFIED",
  REFERRAL_REVERSED: "REFERRAL_REVERSED",
  CREDIT_ADJUSTED: "CREDIT_ADJUSTED",
  PROGRESS_REPORT_SUBMITTED: "PROGRESS_REPORT_SUBMITTED",
  PROGRESS_REPORT_REVISED: "PROGRESS_REPORT_REVISED",
  PROGRESS_REPORT_ARCHIVED: "PROGRESS_REPORT_ARCHIVED",
  CALENDAR_CONNECTED: "CALENDAR_CONNECTED",
  CALENDAR_DISCONNECTED: "CALENDAR_DISCONNECTED",
  CALENDAR_SYNC_FAILED: "CALENDAR_SYNC_FAILED",
  PHONE_VERIFIED: "PHONE_VERIFIED",
  PHONE_REMOVED: "PHONE_REMOVED",
  SMS_OPTED_OUT: "SMS_OPTED_OUT",
  REQUEST_CREATED: "REQUEST_CREATED",
  REQUEST_UPDATED: "REQUEST_UPDATED",
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  REQUEST_CLOSED: "REQUEST_CLOSED",
  REQUEST_EXPIRED: "REQUEST_EXPIRED",
  REQUEST_MODERATED: "REQUEST_MODERATED",
  REQUEST_TUTOR_INVITED: "REQUEST_TUTOR_INVITED",
  USER_LOGIN: "USER_LOGIN",
  USER_LOGOUT: "USER_LOGOUT",
  USER_REGISTERED: "USER_REGISTERED",
  USER_SUSPENDED: "USER_SUSPENDED",
  USER_REINSTATED: "USER_REINSTATED",
  USER_DELETED: "USER_DELETED",
  TUTOR_APPLICATION_SUBMITTED: "TUTOR_APPLICATION_SUBMITTED",
  TUTOR_APPROVED: "TUTOR_APPROVED",
  TUTOR_REJECTED: "TUTOR_REJECTED",
  TUTOR_INFO_REQUESTED: "TUTOR_INFO_REQUESTED",
  VERIFICATION_BADGE_GRANTED: "VERIFICATION_BADGE_GRANTED",
  VERIFICATION_BADGE_REVOKED: "VERIFICATION_BADGE_REVOKED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_NO_SHOW_REPORTED: "BOOKING_NO_SHOW_REPORTED",
  BOOKING_EXPIRED: "BOOKING_EXPIRED",
  BOOKING_RESCHEDULED: "BOOKING_RESCHEDULED",
  PAYMENT_SETTLED: "PAYMENT_SETTLED",
  REFUND_ISSUED: "REFUND_ISSUED",
  PAYOUT_MARKED_PAID: "PAYOUT_MARKED_PAID",
  REVIEW_MODERATED: "REVIEW_MODERATED",
  CONVERSATION_REPORT_VIEWED: "CONVERSATION_REPORT_VIEWED",
  CONVERSATION_MODERATED: "CONVERSATION_MODERATED",
  DISPUTE_RESOLVED: "DISPUTE_RESOLVED",
  SCHEDULED_JOB_RUN: "SCHEDULED_JOB_RUN",
  SETTINGS_UPDATED: "SETTINGS_UPDATED",
  CURRICULUM_UPDATED: "CURRICULUM_UPDATED",
};
