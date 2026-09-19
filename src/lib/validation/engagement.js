import { z } from "zod";
import {
  LESSON_MODES,
  REVIEW_STATUS,
  REPORT_STATUS,
  REQUEST_STATUS,
  REQUEST_URGENCY,
  REQUEST_VISIBILITY,
  QUALIFICATION_TYPES,
} from "@/constants";
import { objectId, cents, rating, isoDate, provinceCode, postalCode } from "./common";

export const sendMessageSchema = z.object({
  conversationId: objectId.optional(),
  /** Starting a new thread from a tutor profile. */
  tutorProfileId: objectId.optional(),
  bookingId: objectId.optional(),
  requestId: objectId.optional(),
  body: z
    .string()
    .trim()
    .min(1, "Write a message first.")
    .max(4000, "That message is too long."),
}).refine((d) => d.conversationId || d.tutorProfileId, {
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

export const createReviewSchema = z.object({
  bookingId: objectId,
  rating,
  knowledge: rating,
  communication: rating,
  reliability: rating,
  teaching: rating,
  title: z.string().trim().max(120).optional(),
  body: z
    .string()
    .trim()
    .min(20, "Write at least 20 characters so other parents can learn from it.")
    .max(2000),
});

export const replyToReviewSchema = z.object({
  reply: z.string().trim().min(10, "Write a reply of at least 10 characters.").max(1200),
});

export const reportReviewSchema = z.object({
  reason: z.string().trim().min(10, "Tell us what is wrong with this review.").max(600),
});

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
  preferredQualifications: z
    .array(z.enum(Object.values(QUALIFICATION_TYPES)))
    .max(6)
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
    preferredQualifications: z.array(z.enum(Object.values(QUALIFICATION_TYPES))).max(6).optional(),
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

/** A moderator removing a request from the board, or putting it back. */
export const moderateRequestSchema = z.object({
  action: z.enum(["REMOVE", "RESTORE"]),
  note: z.string().trim().min(5, "Record why.").max(600),
});

export const adminRequestQuerySchema = z.object({
  status: z.enum(Object.values(REQUEST_STATUS)).optional(),
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
