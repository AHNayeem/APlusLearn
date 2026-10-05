import { z } from "zod";
import {
  LESSON_MODES,
  MEETING_PROVIDERS,
  IN_PERSON_LOCATIONS,
  QUALIFICATION_TYPES,
  OFFERED_QUALIFICATION_TYPES,
  VERIFICATION_TYPES,
  TUTOR_STATUS,
} from "@/constants";
import { ONBOARDING_STEPS } from "@/constants/onboarding";
import {
  objectId, personName, phone, postalCode, provinceCode, cents, timeZone,
  optionalUrl, mediaUrl,
} from "./common";

const year = z.coerce.number().int().min(1950).max(new Date().getFullYear() + 8);

/**
 * Qualification categories (§8, §13, R13.5).
 *
 * A new answer — an onboarding step — may only use the categories the forms
 * offer. An edit of something already stored also accepts the legacy ones, so
 * a tutor whose profile predates the current list can still save it;
 * `scripts/migrate-qualifications.mjs` moves stored values across.
 */
const offeredQualification = z.enum(OFFERED_QUALIFICATION_TYPES, {
  message: "Choose from the current list of qualifications.",
});
const storedQualification = z.enum(Object.values(QUALIFICATION_TYPES));

/** Free-text credentials beyond the fixed list — short and bounded (R13.5). */
export const OTHER_CREDENTIALS_LIMITS = { max: 10, maxLength: 120 };
const otherCredentials = z
  .array(
    z
      .string()
      .trim()
      .min(2, "Describe the credential in a few words.")
      .max(OTHER_CREDENTIALS_LIMITS.maxLength, `Keep each credential under ${OTHER_CREDENTIALS_LIMITS.maxLength} characters.`),
  )
  .max(OTHER_CREDENTIALS_LIMITS.max, `List up to ${OTHER_CREDENTIALS_LIMITS.max} other credentials.`);

const octNumber = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "An OCT number is six digits.")
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * An administrator's expiry date for a badge: a calendar date from a date
 * input, or a full timestamp. Whether it is in the future is the service's
 * call, against its own clock.
 */
const badgeExpiry = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);

export const educationEntrySchema = z
  .object({
    institution: z.string().trim().min(2, "Enter the institution.").max(120),
    credential: z.string().trim().min(2, "Enter the credential.").max(120),
    fieldOfStudy: z.string().trim().max(120).optional(),
    startYear: year.optional(),
    endYear: year.optional(),
    inProgress: z.boolean().default(false),
  })
  .refine((d) => !d.startYear || !d.endYear || d.endYear >= d.startYear, {
    message: "The end year cannot be before the start year.",
    path: ["endYear"],
  });

export const experienceEntrySchema = z
  .object({
    title: z.string().trim().min(2, "Enter the role.").max(120),
    organisation: z.string().trim().max(120).optional(),
    startYear: year.optional(),
    endYear: year.optional(),
    current: z.boolean().default(false),
    description: z.string().trim().max(600).optional(),
  })
  .refine((d) => !d.startYear || !d.endYear || d.endYear >= d.startYear, {
    message: "The end year cannot be before the start year.",
    path: ["endYear"],
  });

export const taughtCourseSchema = z.object({
  courseId: objectId,
  hourlyRateCents: cents.optional(),
  yearsTeaching: z.coerce.number().int().min(0).max(60).default(0),
});

/** Per-step onboarding payloads (§17). Each step validates independently. */
export const onboardingStepSchemas = {
  PERSONAL: z.object({
    firstName: personName,
    lastName: personName,
    phone,
    timeZone,
    province: provinceCode,
    city: z.string().trim().min(2, "Enter your city.").max(80),
  }),

  PROFILE: z.object({
    headline: z
      .string()
      .trim()
      .min(10, "Write a headline of at least 10 characters.")
      .max(120, "Keep the headline under 120 characters."),
    bio: z
      .string()
      .trim()
      .min(120, "Write at least 120 characters so parents can get to know you.")
      .max(4000),
    languages: z.array(z.string().trim().min(2).max(40)).min(1, "Add at least one language."),
    // The photo is not a field of this form. It is uploaded through
    // `POST /api/users/me/avatar`, inspected byte by byte, and stored — so
    // what reaches a family's screen is a file this platform holds rather than
    // a URL an application could be talked into pointing anywhere (§16).
    introVideoUrl: optionalUrl,
    /** Teaching-environment photos shown on the search card gallery. */
    gallery: z.array(mediaUrl).max(6, "Up to six photos.").optional(),
  }),

  EDUCATION: z.object({
    education: z.array(educationEntrySchema).min(1, "Add at least one qualification."),
  }),

  QUALIFICATIONS: z.object({
    qualifications: z.array(offeredQualification).min(1, "Select at least one qualification."),
    octNumber,
    otherCredentials: otherCredentials.default([]),
    yearsExperience: z.coerce.number().int().min(0).max(60),
    experience: z.array(experienceEntrySchema).default([]),
  }),

  COURSES: z.object({
    courses: z.array(taughtCourseSchema).min(1, "Add at least one course you teach."),
  }),

  LESSON_TYPE: z
    .object({
      lessonModes: z
        .array(z.enum(Object.values(LESSON_MODES)))
        .min(1, "Choose at least one lesson type."),
      onlineMeetingProviders: z.array(z.enum(Object.values(MEETING_PROVIDERS))).default([]),
      inPersonLocationTypes: z.array(z.enum(Object.values(IN_PERSON_LOCATIONS))).default([]),
    })
    .refine(
      (d) => !d.lessonModes.includes(LESSON_MODES.ONLINE) || d.onlineMeetingProviders.length > 0,
      { message: "Choose at least one meeting platform.", path: ["onlineMeetingProviders"] },
    )
    .refine(
      (d) => !d.lessonModes.includes(LESSON_MODES.IN_PERSON) || d.inPersonLocationTypes.length > 0,
      { message: "Choose where you can teach in person.", path: ["inPersonLocationTypes"] },
    ),

  LOCATION: z.object({
    city: z.string().trim().min(2, "Enter your city.").max(80),
    province: provinceCode,
    postalCode,
    travelRadiusKm: z.coerce.number().int().min(0).max(200).default(15),
  }),

  // The platform's rate range is a setting (`minHourlyRate` / `maxHourlyRate`),
  // so it is enforced by the service against the stored settings rather than
  // frozen into this schema (R13.9).
  PRICING: z
    .object({
      hourlyRateCents: cents.refine((v) => v > 0, "Enter your hourly rate."),
      offersFreeIntro: z.boolean().default(false),
      trialRateCents: cents.optional(),
      acceptingNewStudents: z.boolean().default(true),
    })
    .refine((d) => !d.trialRateCents || d.trialRateCents <= d.hourlyRateCents, {
      message: "An intro rate should not exceed your hourly rate.",
      path: ["trialRateCents"],
    }),

  AVAILABILITY: z.object({
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
      .min(1, "Add at least one weekly availability window."),
    bufferMinutes: z.coerce.number().int().min(0).max(120).default(0),
    slotIncrementMinutes: z.coerce.number().int().min(15).max(60).default(30),
    minNoticeHours: z.coerce.number().int().min(0).max(168).default(4),
  }),

  DOCUMENTS: z.object({
    // Documents upload through their own endpoint; this step records intent.
    requestedBadges: z
      .array(z.enum(Object.values(VERIFICATION_TYPES)))
      .min(1, "Request at least identity verification."),
  }),

  REVIEW: z.object({
    confirmAccurate: z.literal(true, {
      message: "Confirm your information is accurate before submitting.",
    }),
  }),
};

export const saveOnboardingStepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS),
  data: z.record(z.string(), z.unknown()),
});

/** Direct edits to an approved profile (tutor dashboard). */
export const updateTutorProfileSchema = z.object({
  headline: z.string().trim().min(10).max(120).optional(),
  bio: z.string().trim().min(120).max(4000).optional(),
  languages: z.array(z.string().trim().min(2).max(40)).min(1).optional(),
  // See the onboarding PROFILE step: the photo is an upload, not a URL.
  introVideoUrl: optionalUrl,
  /** Teaching-environment photos shown on the search card gallery. */
  gallery: z.array(mediaUrl).max(6, "Up to six photos.").optional(),
  education: z.array(educationEntrySchema).optional(),
  experience: z.array(experienceEntrySchema).optional(),
  qualifications: z.array(storedQualification).min(1, "Select at least one qualification.").optional(),
  octNumber,
  otherCredentials: otherCredentials.optional(),
  yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
  courses: z.array(taughtCourseSchema).min(1).optional(),
  lessonModes: z.array(z.enum(Object.values(LESSON_MODES))).min(1).optional(),
  onlineMeetingProviders: z.array(z.enum(Object.values(MEETING_PROVIDERS))).optional(),
  inPersonLocationTypes: z.array(z.enum(Object.values(IN_PERSON_LOCATIONS))).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  province: provinceCode.optional(),
  postalCode: postalCode.optional(),
  travelRadiusKm: z.coerce.number().int().min(0).max(200).optional(),
  hourlyRateCents: cents.optional(),
  offersFreeIntro: z.boolean().optional(),
  trialRateCents: cents.optional(),
  acceptingNewStudents: z.boolean().optional(),
  timeZone: timeZone.optional(),
});

/** Admin decision on an application (§16). */
export const reviewApplicationSchema = z
  .object({
    decision: z.enum([
      TUTOR_STATUS.APPROVED,
      TUTOR_STATUS.REJECTED,
      TUTOR_STATUS.INFO_REQUESTED,
    ]),
    message: z.string().trim().max(1500).optional(),
    grantBadges: z.array(z.enum(Object.values(VERIFICATION_TYPES))).default([]),
    /**
     * Per-badge expiry the reviewer chose. A Background Check granted without
     * one gets the `backgroundCheckValidityMonths` default (R11.5).
     */
    badgeExpiresAt: z.partialRecord(z.enum(Object.values(VERIFICATION_TYPES)), badgeExpiry).optional(),
    /**
     * Education entries the reviewer checked against a document (R10.11).
     * When present it is the complete list — an entry left out is unverified.
     */
    verifiedEducationIds: z.array(objectId).max(30).optional(),
  })
  .refine(
    (d) => d.decision === TUTOR_STATUS.APPROVED || (d.message && d.message.length >= 10),
    { message: "Explain the decision so the tutor knows what to do next.", path: ["message"] },
  );

export const verificationDecisionSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED", "INFO_REQUESTED"]),
    note: z.string().trim().max(1000).optional(),
    referenceNumber: z.string().trim().max(60).optional(),
    expiresAt: badgeExpiry.optional(),
    /** With an approved EDUCATION record: the entries the document proves. */
    educationEntryIds: z.array(objectId).max(30).optional(),
  })
  .refine((d) => d.status === "APPROVED" || (d.note && d.note.length >= 5), {
    message: "Add a note explaining the decision.",
    path: ["note"],
  });

export const badgeMutationSchema = z.object({
  type: z.enum(Object.values(VERIFICATION_TYPES)),
  action: z.enum(["GRANT", "REVOKE"]),
  reason: z.string().trim().max(500).optional(),
  /** A grant's expiry; Background Check defaults from settings (R11.5, R28.8). */
  expiresAt: badgeExpiry.optional().or(z.literal("").transform(() => undefined)),
  /** For an EDUCATION grant: the entries the evidence covers (R10.11). */
  educationEntryIds: z.array(objectId).max(30).optional(),
});

/**
 * Changing a calendar connection (§18, §41 Phase 2).
 *
 * Only the three things a tutor owns: which calendar, and which of the two
 * directions are on. Tokens, status and the account itself are not editable
 * through any request — they come from the provider (§42).
 */
export const updateCalendarConnectionSchema = z.object({
  calendarId: z.string().trim().min(1).max(512).optional(),
  syncBusy: z.boolean().optional(),
  pushEvents: z.boolean().optional(),
});
