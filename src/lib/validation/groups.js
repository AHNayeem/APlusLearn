import { z } from "zod";
import {
  GROUP_SESSION_STATUS,
  LESSON_MODES,
  LESSON_DURATIONS,
  MEETING_PROVIDERS,
  IN_PERSON_LOCATIONS,
} from "@/constants";
import { objectId, cents, isoDate } from "./common";

/**
 * Group sessions (§41 Phase 2).
 *
 * `seatsTaken`, `status`, `commissionPercent` and `confirmBy` are absent from
 * every write schema: each is derived or owned by the lifecycle, and a
 * request that could set them could sell a seat that does not exist (§42).
 */

const sessionBody = {
  title: z.string().trim().min(3, "Give the session a name.").max(120),
  description: z.string().trim().max(2000).optional(),
  mode: z.enum(Object.values(LESSON_MODES)),
  meetingProvider: z.enum(Object.values(MEETING_PROVIDERS)).optional(),
  location: z
    .object({
      type: z.enum(Object.values(IN_PERSON_LOCATIONS)),
      label: z.string().trim().max(120).optional(),
      addressLine: z.string().trim().max(200).optional(),
      city: z.string().trim().max(80).optional(),
      postalCode: z.string().trim().max(10).optional(),
      notes: z.string().trim().max(500).optional(),
    })
    .optional(),
  startAt: isoDate,
  durationMinutes: z.coerce
    .number()
    .int()
    .refine((v) => LESSON_DURATIONS.includes(v), "Choose one of the standard lesson lengths."),
  minParticipants: z.coerce.number().int().min(1).max(100),
  maxParticipants: z.coerce.number().int().min(1).max(100),
  pricePerSeatCents: cents,
};

export const createGroupSessionSchema = z
  .object({ ...sessionBody, courseId: objectId })
  .refine((d) => d.minParticipants <= d.maxParticipants, {
    message: "The minimum cannot be larger than the maximum.",
    path: ["minParticipants"],
  })
  .refine((d) => d.mode !== LESSON_MODES.ONLINE || Boolean(d.meetingProvider), {
    message: "Choose a meeting platform for an online session.",
    path: ["meetingProvider"],
  })
  .refine((d) => d.mode !== LESSON_MODES.IN_PERSON || Boolean(d.location), {
    message: "Say where an in-person session takes place.",
    path: ["location"],
  });

export const updateGroupSessionSchema = z.object({
  title: sessionBody.title.optional(),
  description: sessionBody.description,
  startAt: isoDate.optional(),
  durationMinutes: sessionBody.durationMinutes.optional(),
  minParticipants: sessionBody.minParticipants.optional(),
  maxParticipants: sessionBody.maxParticipants.optional(),
  pricePerSeatCents: cents.optional(),
});

export const joinGroupSessionSchema = z.object({
  studentProfileId: objectId,
  studentNotes: z.string().trim().max(1000).optional(),
});

export const leaveWaitlistSchema = z.object({
  studentProfileId: objectId,
});

export const cancelGroupSessionSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

/** Who turned up. The enrolment ids come from the roster, never from a name. */
export const recordAttendanceSchema = z.object({
  attendance: z
    .array(
      z.object({
        enrolmentId: objectId,
        attended: z.boolean(),
      }),
    )
    .min(1, "Mark at least one person.")
    .max(100),
});

export const groupSessionQuerySchema = z.object({
  courseId: objectId.optional(),
  tutorProfileId: objectId.optional(),
  gradeLevel: z.coerce.number().int().min(0).max(13).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const tutorGroupQuerySchema = z.object({
  status: z.enum(Object.values(GROUP_SESSION_STATUS)).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
