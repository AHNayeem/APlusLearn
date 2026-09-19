import { z } from "zod";
import { NOTIFICATION_CHANNELS } from "@/constants";
import { personName, phone, postalCode, provinceCode, timeZone, objectId } from "./common";

export const updateProfileSchema = z.object({
  firstName: personName.optional(),
  lastName: personName.optional(),
  phone: phone.optional().or(z.literal("").transform(() => undefined)),
  avatarUrl: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  province: provinceCode.optional(),
  postalCode: postalCode.optional().or(z.literal("").transform(() => undefined)),
  timeZone: timeZone.optional(),
});

export const notificationPreferencesSchema = z.object({
  [NOTIFICATION_CHANNELS.IN_APP]: z.boolean().optional(),
  [NOTIFICATION_CHANNELS.EMAIL]: z.boolean().optional(),
  [NOTIFICATION_CHANNELS.SMS]: z.boolean().optional(),
  [NOTIFICATION_CHANNELS.PUSH]: z.boolean().optional(),
});

/**
 * A mobile number, kept in both the shapes that matter (§41 Phase 2).
 *
 * `phone` is what the person typed, normalised the way the rest of the
 * product already stores it. `phoneE164` is what a carrier needs, derived
 * here rather than in the service so a request can never supply one that
 * disagrees with the other.
 *
 * Canada only, because that is the marketplace: the `phone` primitive already
 * refuses anything that is not a NANP number, and prefixing +1 is therefore
 * correct rather than a guess.
 */
export const startPhoneVerificationSchema = z
  .object({ phone })
  .transform((v) => ({ phone: v.phone, phoneE164: `+1${v.phone}` }));

export const confirmPhoneVerificationSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code we sent you."),
});

export const studentProfileSchema = z.object({
  firstName: personName,
  lastName: personName.optional().or(z.literal("").transform(() => undefined)),
  birthYear: z.coerce
    .number()
    .int()
    .min(new Date().getFullYear() - 80)
    .max(new Date().getFullYear())
    .optional(),
  provinceCode: provinceCode.optional(),
  gradeId: objectId.optional(),
  school: z.string().trim().max(120).optional(),
  subjectsOfInterest: z.array(objectId).max(12).default([]),
  currentCourses: z.array(objectId).max(20).default([]),
  notes: z.string().trim().max(1500).optional(),
  accessibilityNeeds: z.string().trim().max(1000).optional(),
  shareFullNameWithTutor: z.boolean().default(false),
  avatarUrl: z.string().trim().max(500).optional(),
});

export const updateStudentProfileSchema = studentProfileSchema.partial();

export const learningGoalSchema = z.object({
  label: z.string().trim().min(2).max(160),
  targetDate: z.iso.datetime({ offset: true }).optional(),
});

/** Account deletion requires typing the confirmation phrase (§35). */
export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE MY ACCOUNT", {
    message: 'Type "DELETE MY ACCOUNT" exactly to confirm.',
  }),
  password: z.string().min(1, "Enter your password to confirm.").optional(),
});
