import { z } from "zod";
import {
  LESSON_MODES,
  REVIEW_STATUS,
  REPORT_STATUS,
  REQUEST_STATUS,
  REQUEST_URGENCY,
  REQUEST_VISIBILITY,
  QUALIFICATION_TYPES,
  OFFERED_QUALIFICATION_TYPES,
  REQUEST_REPORT_REASONS,
} from "@/constants";
import { objectId, cents, rating, isoDate, provinceCode, postalCode } from "./common";

/**
 * The browser's idempotency key for one send (docs/REALTIME.md). Optional, so
 * every existing caller keeps working; a UUID, so it cannot carry anything.
 */
const messageClientId = z.uuid("That message reference is not valid.").optional();

/**
 * A message goes into a thread, or starts one: a learner names a tutor, a
 * tutor names the booking whose family they are writing to (R17.1, R23.6).
 * Whether this sender may use the route they chose is the service's call.
 */
const messageHasRecipient = (d) => Boolean(d.conversationId || d.tutorProfileId || d.bookingId);

export const sendMessageSchema = z.object({
  conversationId: objectId.optional(),
  /** Starting a new thread from a tutor profile. */
  tutorProfileId: objectId.optional(),
  /** Context for a new thread; for a tutor, the booking that allows it. */
  bookingId: objectId.optional(),
  requestId: objectId.optional(),
  body: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(4000, "That message is too long."),
  clientId: messageClientId,
}).refine(messageHasRecipient, {
  message: "We need to know who this message is for.",
  path: ["conversationId"],
});

/**
 * The text fields of a multipart message upload (§41 Phase 3).
 *
 * A `FormData` value is always a string, so `body` may legitimately arrive
 * empty — a worksheet sent with nothing typed is an ordinary message. The
 * service is what refuses a message that has neither text nor a file; this
 * schema's job is the same one `sendMessageSchema` does, which is to insist
 * that we know who the message is for.
 */
export const messageAttachmentSchema = z.object({
  conversationId: objectId.optional(),
  tutorProfileId: objectId.optional(),
  bookingId: objectId.optional(),
  requestId: objectId.optional(),
  body: z.string().trim().max(4000, "That message is too long.").optional().default(""),
  clientId: messageClientId,
}).refine(messageHasRecipient, {
  message: "We need to know who this message is for.",
  path: ["conversationId"],
});

export const reportConversationSchema = z.object({
  reason: z.string().trim().min(10, "Tell us what happened.").max(600),
});

/** A moderator's ruling on a reported conversation (§21). */
export const moderateConversationSchema = z.object({
  status: z.enum([
    REPORT_STATUS.REVIEWING,
    REPORT_STATUS.RESOLVED,
    REPORT_STATUS.DISMISSED,
  ]),
  note: z.string().trim().max(600).optional(),
});

export const reportedConversationQuerySchema = z.object({
  status: z.enum(Object.values(REPORT_STATUS)).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * A written review is optional (R21.2): the star rating is the review, and a
 * family who only wants to leave stars may. What is refused is a body that
 * says nothing — if words are given, at least ten of them must be more than
 * whitespace. An empty or blank body arrives as "no body", not as a short one.
 */
const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const createReviewSchema = z.object({
  bookingId: objectId,
  rating,
  knowledge: rating,
  communication: rating,
  reliability: rating,
  teaching: rating,
  title: optionalText(120),
  body: optionalText(2000).refine(
    (v) => v === undefined || v.replace(/\s/g, "").length >= 10,
    "If you write a review, make it at least 10 characters so other parents can learn from it.",
  ),
});

export const replyToReviewSchema = z.object({
  reply: z.string().trim().min(10, "Write a reply of at least 10 characters.").max(1200),
});

export const reportReviewSchema = z.object({
  reason: z.string().trim().min(10, "Tell us what is wrong with this review.").max(600),
});

/**
 * A moderator's ruling on a review: publish it (approving one awaiting
 * approval, or dismissing a report) or remove it (R21.5).
 */
export const moderateReviewSchema = z.object({
  status: z.enum([REVIEW_STATUS.PUBLISHED, REVIEW_STATUS.REMOVED]),
  note: z.string().trim().max(600).optional(),
});

export const favouriteSchema = z.object({
  tutorProfileId: objectId,
  note: z.string().trim().max(300).optional(),
});

/**
 * The parts of a tutor request the family describes (§22, §41 Phase 2).
 *
 * Split out from the create schema so editing validates exactly the same
 * rules as posting — a budget that was refused at creation cannot be slipped
 * in through an edit.
 */
const requestBrief = {
  title: z.string().trim().max(120).optional(),
  modes: z.array(z.enum(Object.values(LESSON_MODES))).min(1, "Choose at least one lesson type."),
  city: z.string().trim().max(80).optional(),
  postalCode: postalCode.optional().or(z.literal("").transform(() => undefined)),
  maxDistanceKm: z.coerce.number().int().min(1).max(200).default(25),
  preferredWindows: z
    .array(z.enum(["WEEKDAY_MORNING", "WEEKDAY_AFTERNOON", "WEEKDAY_EVENING", "WEEKEND"]))
    .min(1, "Choose when lessons could take place."),
  sessionsPerWeek: z.coerce.number().int().min(1).max(7).default(1),
  preferredDurationMinutes: z.coerce.number().int().min(30).max(180).default(60),
  budgetMinCents: cents.optional(),
  budgetMaxCents: cents,
  languages: z.array(z.string().trim().min(2).max(40)).max(5).default([]),
  minYearsExperience: z.coerce.number().int().min(0).max(50).optional(),
  // A new request may only name the categories the form offers (§8, R13.5);
  // an edit also accepts the legacy ones a stored request may still carry.
  preferredQualifications: z
    .array(z.enum(OFFERED_QUALIFICATION_TYPES, { message: "Choose from the current list of qualifications." }))
    .max(OFFERED_QUALIFICATION_TYPES.length)
    .default([]),
  urgency: z.enum(Object.values(REQUEST_URGENCY)).default(REQUEST_URGENCY.FLEXIBLE),
  visibility: z.enum(Object.values(REQUEST_VISIBILITY)).default(REQUEST_VISIBILITY.PUBLIC),
  goal: z.string().trim().min(10, "Describe what you want to achieve.").max(500),
  startDate: isoDate.optional(),
  notes: z.string().trim().max(2000).optional(),
};

/** Rules that hold however a request arrives. */
const budgetOrder = (d) => !d.budgetMinCents || !d.budgetMaxCents || d.budgetMinCents <= d.budgetMaxCents;
const inPersonNeedsPlace = (d) =>
  !d.modes?.includes(LESSON_MODES.IN_PERSON) || Boolean(d.postalCode || d.city);

/** Post a tutor request (§22). */
export const createTutorRequestSchema = z
  .object({
    ...requestBrief,
    studentProfileId: objectId,
    courseId: objectId,
    provinceCode: provinceCode.optional(),
  })
  .refine(budgetOrder, {
    message: "The minimum budget cannot exceed the maximum.",
    path: ["budgetMinCents"],
  })
  .refine(inPersonNeedsPlace, {
    message: "Add a city or postal code for in-person lessons.",
    path: ["city"],
  });

/**
 * Edit an open request. Course and learner are deliberately absent: changing
 * either makes it a different request, and the tutors who already answered
 * answered the old one.
 */
export const updateTutorRequestSchema = z
  .object({
    ...requestBrief,
    modes: requestBrief.modes.optional(),
    preferredWindows: requestBrief.preferredWindows.optional(),
    budgetMaxCents: cents.optional(),
    goal: z.string().trim().min(10, "Describe what you want to achieve.").max(500).optional(),
    languages: z.array(z.string().trim().min(2).max(40)).max(5).optional(),
    preferredQualifications: z
      .array(z.enum(Object.values(QUALIFICATION_TYPES)))
      .max(Object.values(QUALIFICATION_TYPES).length)
      .optional(),
    urgency: z.enum(Object.values(REQUEST_URGENCY)).optional(),
    visibility: z.enum(Object.values(REQUEST_VISIBILITY)).optional(),
    maxDistanceKm: z.coerce.number().int().min(1).max(200).optional(),
    sessionsPerWeek: z.coerce.number().int().min(1).max(7).optional(),
    preferredDurationMinutes: z.coerce.number().int().min(30).max(180).optional(),
  })
  .refine(budgetOrder, {
    message: "The minimum budget cannot exceed the maximum.",
    path: ["budgetMinCents"],
  })
  .refine((d) => d.modes === undefined || inPersonNeedsPlace(d), {
    message: "Add a city or postal code for in-person lessons.",
    path: ["city"],
  });

export const inviteTutorsSchema = z.object({
  tutorProfileIds: z
    .array(objectId)
    .min(1, "Choose at least one tutor to invite.")
    .max(10, "You can invite up to 10 tutors at a time."),
});

/** A tutor stepping back: withdrawing a pitch, or declining an invitation. */
export const withdrawFromRequestSchema = z.object({
  action: z.enum(["WITHDRAW", "DECLINE"]).default("WITHDRAW"),
  reason: z.string().trim().max(300).optional(),
});

export const cancelRequestSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

/**
 * A moderator removing a request from the board, putting it back, or
 * dismissing the report case against it (R28.24).
 */
export const moderateRequestSchema = z.object({
  action: z.enum(["REMOVE", "RESTORE", "DISMISS_REPORT"]),
  note: z.string().trim().min(5, "Record why.").max(600),
});

/** A member reporting a tutor request (R28.24). */
export const reportRequestSchema = z.object({
  reason: z.enum(Object.keys(REQUEST_REPORT_REASONS), "Choose why you are reporting this request."),
  note: z.string().trim().max(600, "Keep it under 600 characters.").optional(),
});

export const adminRequestQuerySchema = z.object({
  status: z.enum(Object.values(REQUEST_STATUS)).optional(),
  /** The report queue: requests with an open report case. */
  reported: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const expressInterestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(30, "Write at least 30 characters so the parent can see why you're a fit.")
    .max(1200),
  proposedRateCents: cents.optional(),
});

export const respondToMatchSchema = z.object({
  action: z.enum(["SHORTLIST", "DECLINE"]),
});

export const closeRequestSchema = z.object({
  reason: z.enum(["BOOKED", "NO_LONGER_NEEDED", "OTHER"]).default("NO_LONGER_NEEDED"),
  bookedTutorProfileId: objectId.optional(),
});

export const notificationQuerySchema = z.object({
  unreadOnly: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  page: z.coerce.number().int().min(1).max(100).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const markNotificationsSchema = z.object({
  ids: z.array(objectId).max(100).optional(),
  all: z.boolean().default(false),
});
