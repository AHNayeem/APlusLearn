import { z } from "zod";
import { LESSON_MODES, REVIEW_STATUS } from "@/constants";
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

/** Post a tutor request (§22). */
export const createTutorRequestSchema = z
  .object({
    studentProfileId: objectId,
    courseId: objectId,
    modes: z.array(z.enum(Object.values(LESSON_MODES))).min(1, "Choose at least one lesson type."),
    city: z.string().trim().max(80).optional(),
    postalCode: postalCode.optional().or(z.literal("").transform(() => undefined)),
    provinceCode: provinceCode.optional(),
    maxDistanceKm: z.coerce.number().int().min(1).max(200).default(25),
    preferredWindows: z
      .array(z.enum(["WEEKDAY_MORNING", "WEEKDAY_AFTERNOON", "WEEKDAY_EVENING", "WEEKEND"]))
      .min(1, "Choose when lessons could take place."),
    sessionsPerWeek: z.coerce.number().int().min(1).max(7).default(1),
    preferredDurationMinutes: z.coerce.number().int().min(30).max(180).default(60),
    budgetMinCents: cents.optional(),
    budgetMaxCents: cents,
    goal: z.string().trim().min(10, "Describe what you want to achieve.").max(500),
    startDate: isoDate.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((d) => !d.budgetMinCents || d.budgetMinCents <= d.budgetMaxCents, {
    message: "The minimum budget cannot exceed the maximum.",
    path: ["budgetMinCents"],
  })
  .refine(
    (d) => !d.modes.includes(LESSON_MODES.IN_PERSON) || !!(d.postalCode || d.city),
    { message: "Add a city or postal code for in-person lessons.", path: ["city"] },
  );

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
