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

export const REQUEST_STATUS = {
  OPEN: "OPEN",
  MATCHED: "MATCHED",
  CLOSED: "CLOSED",
  EXPIRED: "EXPIRED",
};

export const REQUEST_STATUS_LABELS = {
  OPEN: "Open",
  MATCHED: "Matched",
  CLOSED: "Closed",
  EXPIRED: "Expired",
};

export const MATCH_STATUS = {
  SUGGESTED: "SUGGESTED",
  TUTOR_INTERESTED: "TUTOR_INTERESTED",
  SHORTLISTED: "SHORTLISTED",
  DECLINED: "DECLINED",
  BOOKED: "BOOKED",
};

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
  PAYOUT_UPDATED: "PAYOUT_UPDATED",
  REVIEW_RECEIVED: "REVIEW_RECEIVED",
  DISPUTE_UPDATED: "DISPUTE_UPDATED",
};

export const NOTIFICATION_CHANNELS = {
  IN_APP: "IN_APP",
  EMAIL: "EMAIL",
  SMS: "SMS",
  PUSH: "PUSH",
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
