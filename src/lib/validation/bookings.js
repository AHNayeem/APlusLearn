import { z } from "zod";
import {
  LESSON_MODES,
  MEETING_PROVIDERS,
  IN_PERSON_LOCATIONS,
  RECURRENCE,
  LESSON_DURATIONS,
  BOOKING_STATUS,
  DISPUTE_REASONS,
} from "@/constants";
import { objectId, cents, dayKey, isoDate } from "./common";

export const availabilityQuerySchema = z.object({
  from: dayKey.optional(),
  days: z.coerce.number().int().min(1).max(60).default(14),
  durationMinutes: z.coerce
    .number()
    .int()
    .refine((v) => LESSON_DURATIONS.includes(v), "Choose a valid lesson length.")
    .default(60),
});

/**
 * A booking request. Note what is *absent*: no prices. Totals and commission
 * are computed server-side from the tutor's stored rate (§20, §42).
 */
export const createBookingSchema = z
  .object({
    tutorProfileId: objectId,
    studentProfileId: objectId,
    courseId: objectId,
    mode: z.enum(Object.values(LESSON_MODES)),
    startAt: isoDate,
    durationMinutes: z.coerce
      .number()
      .int()
      .refine((v) => LESSON_DURATIONS.includes(v), "Choose a valid lesson length."),
    recurrence: z.enum(Object.values(RECURRENCE)).default(RECURRENCE.NONE),
    /** Number of lessons in the series, including the first. */
    occurrences: z.coerce.number().int().min(1).max(24).default(1),
    meetingProvider: z.enum(Object.values(MEETING_PROVIDERS)).optional(),
    location: z
      .object({
        type: z.enum(Object.values(IN_PERSON_LOCATIONS)),
        label: z.string().trim().max(120).optional(),
        addressLine: z.string().trim().max(200).optional(),
        city: z.string().trim().max(80).optional(),
        postalCode: z.string().trim().toUpperCase().max(8).optional(),
        notes: z.string().trim().max(500).optional(),
      })
      .optional(),
    studentNotes: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.mode !== LESSON_MODES.ONLINE || !!d.meetingProvider, {
    message: "Choose a meeting platform for an online lesson.",
    path: ["meetingProvider"],
  })
  .refine((d) => d.mode !== LESSON_MODES.IN_PERSON || !!d.location, {
    message: "Choose where the in-person lesson will take place.",
    path: ["location"],
  })
  .refine((d) => d.recurrence === RECURRENCE.NONE || d.occurrences > 1, {
    message: "A recurring booking needs at least two lessons.",
    path: ["occurrences"],
  });

/** Price preview before payment — same inputs, no side effects. */
export const quoteBookingSchema = z.object({
  tutorProfileId: objectId,
  courseId: objectId,
  durationMinutes: z.coerce.number().int().min(15).max(240),
  occurrences: z.coerce.number().int().min(1).max(24).default(1),
});

export const cancelBookingSchema = z.object({
  reason: z.string().trim().min(5, "Tell us why so we can apply the right policy.").max(600),
  /** Cancel the whole recurring series rather than one lesson. */
  cancelSeries: z.boolean().default(false),
});

export const rescheduleBookingSchema = z.object({
  startAt: isoDate,
  durationMinutes: z.coerce.number().int().min(15).max(240).optional(),
  reason: z.string().trim().max(600).optional(),
});

export const completeBookingSchema = z.object({
  outcome: z
    .enum([BOOKING_STATUS.COMPLETED, BOOKING_STATUS.NO_SHOW_STUDENT])
    .default(BOOKING_STATUS.COMPLETED),
  tutorNotes: z.string().trim().max(2000).optional(),
});

export const reportNoShowSchema = z.object({
  party: z.enum(["STUDENT", "TUTOR"]),
  note: z.string().trim().min(5).max(600),
});

export const bookingListQuerySchema = z.object({
  scope: z.enum(["UPCOMING", "PAST", "ALL", "CANCELLED", "AWAITING_REVIEW"]).default("UPCOMING"),
  status: z.enum(Object.values(BOOKING_STATUS)).optional(),
  studentProfileId: objectId.optional(),
  tutorProfileId: objectId.optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const availabilityRulesSchema = z.object({
  timeZone: z.string().max(64).optional(),
  weeklyRules: z
    .array(
      z
        .object({
          weekday: z.coerce.number().int().min(0).max(6),
          startMinutes: z.coerce.number().int().min(0).max(1440),
          endMinutes: z.coerce.number().int().min(0).max(1440),
        })
        .refine((r) => r.endMinutes > r.startMinutes, {
          message: "The end time must be after the start time.",
          path: ["endMinutes"],
        }),
    )
    .max(60),
  bufferMinutes: z.coerce.number().int().min(0).max(120).optional(),
  slotIncrementMinutes: z.coerce.number().int().min(15).max(60).optional(),
  minNoticeHours: z.coerce.number().int().min(0).max(168).optional(),
});

export const availabilityExceptionSchema = z
  .object({
    start: isoDate,
    end: isoDate,
    reason: z.string().trim().max(200).optional(),
    kind: z.enum(["BLOCKED", "VACATION", "EXTRA"]).default("BLOCKED"),
  })
  .refine((d) => new Date(d.end) > new Date(d.start), {
    message: "The end must be after the start.",
    path: ["end"],
  });

export const disputeSchema = z.object({
  bookingId: objectId,
  reason: z.enum(Object.values(DISPUTE_REASONS)),
  description: z.string().trim().min(20, "Give us enough detail to investigate.").max(2000),
  requestedRefundCents: cents.optional(),
});

export const resolveDisputeSchema = z
  .object({
    resolution: z.enum([
      "RESOLVED_REFUND",
      "RESOLVED_PARTIAL_REFUND",
      "RESOLVED_NO_REFUND",
      "REJECTED",
    ]),
    refundCents: cents.optional(),
    note: z.string().trim().min(10, "Record why this was decided.").max(1500),
  })
  .refine((d) => d.resolution !== "RESOLVED_PARTIAL_REFUND" || (d.refundCents ?? 0) > 0, {
    message: "Enter the partial refund amount.",
    path: ["refundCents"],
  });
