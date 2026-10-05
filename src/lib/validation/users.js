import { z } from "zod";
import { NOTIFICATION_CHANNELS, LEARNER_MODE_PREFERENCES } from "@/constants";
import { personName, phone, postalCode, provinceCode, timeZone, objectId, patchSchema } from "./common";

/**
 * The editable half of an account (§8).
 *
 * What is *absent* is the contract. `role`, `status`, `emailVerifiedAt`,
 * `tokenVersion`, `creditBalanceCents`, `phoneVerifiedAt` and `email` are all
 * decided elsewhere — by an administrator, by a verification flow, by a
 * payment — so a request that names one is not refused, it is simply not
 * heard: the handler passes only the parsed result to the service.
 *
 * `avatarUrl` is absent for the same reason. It is a string this application
 * renders into an `<img src>` for everyone the account deals with, and it is
 * derived server-side — from an identity provider at sign-in, or from an
 * upload this account actually made. `POST /api/users/me/avatar` is the only
 * way to change it, which is what keeps it pointing at bytes we inspected.
 */
export const updateProfileSchema = z.object({
  firstName: personName.optional(),
  lastName: personName.optional(),
  phone: phone.optional().or(z.literal("").transform(() => undefined)),
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

/**
 * A learner profile (§5).
 *
 * The field list carries no defaults; the create schema adds them. A PATCH
 * that names one field must leave every other field as it is, and Zod's
 * `.partial()` would otherwise fill the defaults back in — which is exactly
 * how an edit used to empty a child's course list (R5.5).
 *
 * On a PATCH, `null` clears an optional field: "I removed the school" and
 * "I did not mention the school" are different instructions.
 */
const optionalText = (max) => z.string().trim().max(max);
const mark = z.coerce.number().min(0, "Marks are between 0 and 100.").max(100, "Marks are between 0 and 100.");

const learningGoalItem = z.object({
  label: z.string().trim().min(2, "Describe the goal in a few words.").max(160),
  targetDate: z.iso.date().optional().or(z.literal("").transform(() => undefined)),
  achieved: z.boolean().optional(),
});

const studentProfileFields = z.object({
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
  school: optionalText(120).optional(),
  subjectsOfInterest: z.array(objectId).max(12),
  currentCourses: z.array(objectId).max(20),
  lessonModePreference: z.enum(Object.values(LEARNER_MODE_PREFERENCES)).optional(),
  currentMark: mark.optional(),
  targetMark: mark.optional(),
  learningGoals: z.array(learningGoalItem).max(10),
  areasForImprovement: optionalText(1000).optional(),
  learningPreferences: optionalText(1000).optional(),
  notes: optionalText(1500).optional(),
  accessibilityNeeds: optionalText(1000).optional(),
  shareFullNameWithTutor: z.boolean(),
  // No `avatarUrl`, for the reason given on `updateProfileSchema`: nothing in
  // the product sets a child's photo, and an arbitrary URL accepted here would
  // be rendered into an `<img src>` shown to that child's tutors.
});

export const studentProfileSchema = studentProfileFields.extend({
  subjectsOfInterest: studentProfileFields.shape.subjectsOfInterest.default([]),
  currentCourses: studentProfileFields.shape.currentCourses.default([]),
  learningGoals: studentProfileFields.shape.learningGoals.default([]),
  shareFullNameWithTutor: studentProfileFields.shape.shareFullNameWithTutor.default(false),
});

/** Fields a PATCH may clear by sending `null`. */
const CLEARABLE = [
  "lastName", "birthYear", "provinceCode", "gradeId", "school", "lessonModePreference",
  "currentMark", "targetMark", "areasForImprovement", "learningPreferences", "notes",
  "accessibilityNeeds",
];

export const updateStudentProfileSchema = z.object(
  Object.fromEntries(
    Object.entries(patchSchema(studentProfileFields).shape).map(([key, field]) => [
      key,
      CLEARABLE.includes(key) ? field.nullable() : field,
    ]),
  ),
);

/** Account deletion requires typing the confirmation phrase (§35). */
export const deleteAccountSchema = z.object({
  confirmation: z.literal("DELETE MY ACCOUNT", {
    message: 'Type "DELETE MY ACCOUNT" exactly to confirm.',
  }),
  password: z.string().min(1, "Enter your password to confirm.").optional(),
});
