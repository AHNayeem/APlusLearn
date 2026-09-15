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
