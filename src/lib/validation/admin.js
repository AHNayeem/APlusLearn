import { z } from "zod";
import {
  ROLES, USER_STATUS, TUTOR_STATUS, PAYOUT_STATUS,
  BRANDING_ASSET_KEYS, FEATURES, SETTINGS_GROUPS,
} from "@/constants";
import {
  isLegible, isUsableAsSolid, isUsableAsSurface, MIN_TEXT_CONTRAST, normalizeHex,
} from "@/lib/theme/palette";
import { objectId, cents, provinceCode, courseCode, email, url } from "./common";

export const adminUserQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  status: z.enum(Object.values(USER_STATUS)).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const adminUserActionSchema = z
  .object({
    action: z.enum(["SUSPEND", "REINSTATE", "VERIFY_EMAIL", "FORCE_LOGOUT", "DELETE"]),
    reason: z.string().trim().max(600).optional(),
  })
  .refine((d) => !["SUSPEND", "DELETE"].includes(d.action) || (d.reason?.length ?? 0) >= 10, {
    message: "Record a reason of at least 10 characters.",
    path: ["reason"],
  });

export const adminApplicationQuerySchema = z.object({
  status: z.enum(Object.values(TUTOR_STATUS)).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const refundSchema = z.object({
  amountCents: cents.refine((v) => v > 0, "Enter a refund amount."),
  reason: z.string().trim().min(10, "Record why this refund was issued.").max(600),
});

export const payoutActionSchema = z.object({
  status: z.enum([PAYOUT_STATUS.SCHEDULED, PAYOUT_STATUS.IN_TRANSIT, PAYOUT_STATUS.PAID, PAYOUT_STATUS.FAILED]),
  note: z.string().trim().max(600).optional(),
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
});

/* --- Platform settings (§20, §26) -------------------------------------------
 *
 * Every field is optional: the admin panel PATCHes one section at a time and
 * an absent key must leave the stored value alone. What is *not* optional is
 * the bound on each one — a commission outside 0–50% or a colour that cannot
 * carry white text is refused here, server-side, whatever the form allowed.
 */

/** Blank is how the admin form clears an optional field; it is not an error. */
const blankable = (schema) => schema.or(z.literal("")).optional();

const optionalEmail = blankable(email);
const optionalUrl = blankable(url);

/**
 * A colour must be a 6-digit hex, and legible for the job it does (§34).
 *
 * Two rules, matching the two ways colour is used in this design system —
 * see `lib/theme/palette.js` for why they differ. Both are enforced here, on
 * the server: the picker's warning is a courtesy, this is the control.
 */
const hexColor = (example) =>
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const hex = normalizeHex(value);
      if (!hex) {
        ctx.addIssue({ code: "custom", message: `Use a hex colour, like ${example}.` });
        return z.NEVER;
      }
      return hex;
    });

/** Roles that always carry white text: solid buttons and the footer band. */
const whiteTextColor = hexColor("#2348d6").refine(isUsableAsSolid, {
  message: `Too light to carry white text — needs ${MIN_TEXT_CONTRAST}:1 contrast against white.`,
});

/** Roles used both as a solid chip and as a tint: legible one way or the other. */
const legibleColor = hexColor("#fe7b12").refine(isLegible, {
  message: `No text colour reads on this — it needs ${MIN_TEXT_CONTRAST}:1 against white or ink.`,
});

/** Page and card grounds sit behind the body text, which is always dark. */
const surfaceColor = hexColor("#f7f9fc").refine(isUsableAsSurface, {
  message: "Too dark for the body text to read on — pick a lighter background.",
});

const brandingSchema = z.object({
  appName: z.string().trim().min(2, "Give the application a name.").max(60).optional(),
  shortName: z.string().trim().max(30).optional(),
  tagline: z.string().trim().max(120).optional(),
  description: z.string().trim().max(300).optional(),
});

const themeSchema = z.object({
  primaryColor: whiteTextColor.optional(),
  footerColor: whiteTextColor.optional(),
  accentColor: legibleColor.optional(),
  successColor: legibleColor.optional(),
  warningColor: legibleColor.optional(),
  dangerColor: legibleColor.optional(),
  canvasColor: surfaceColor.optional(),
  surfaceColor: surfaceColor.optional(),
});

const seoSchema = z.object({
  metaTitle: z.string().trim().max(70, "Search engines truncate past 70 characters.").optional(),
  titleSuffix: z.string().trim().max(40).optional(),
  metaDescription: z
    .string()
    .trim()
    .max(200, "Search engines truncate past 200 characters.")
    .optional(),
  keywords: z.array(z.string().trim().min(1).max(60)).max(25).optional(),
  ogTitle: z.string().trim().max(90).optional(),
  ogDescription: z.string().trim().max(200).optional(),
  twitterHandle: z
    .string()
    .trim()
    .max(20)
    .regex(/^@?[A-Za-z0-9_]{1,15}$/, "Use a handle like @apluslearn.")
    .transform((v) => (v.startsWith("@") ? v : `@${v}`))
    .or(z.literal(""))
    .optional(),
  canonicalBaseUrl: optionalUrl,
  allowIndexing: z.boolean().optional(),
});

const contactSchema = z.object({
  supportEmail: optionalEmail,
  contactEmail: optionalEmail,
  supportPhone: z.string().trim().max(30).optional(),
  addressLine: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  province: blankable(provinceCode),
  postalCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ ]?\d[ABCEGHJ-NPRSTV-Z]\d$/, "Enter a valid Canadian postal code.")
    .or(z.literal(""))
    .optional(),
  websiteUrl: optionalUrl,
  businessHours: z.string().trim().max(120).optional(),
  supportHours: z.string().trim().max(120).optional(),
});

/** Only profiles the footer knows how to render are accepted. */
const socialSchema = z.object({
  facebook: optionalUrl,
  x: optionalUrl,
  linkedin: optionalUrl,
  instagram: optionalUrl,
  youtube: optionalUrl,
});

const footerSchema = z.object({
  description: z.string().trim().max(400).optional(),
  copyrightText: z.string().trim().max(200).optional(),
  showSocial: z.boolean().optional(),
  showNewsletter: z.boolean().optional(),
  showAppBadges: z.boolean().optional(),
});

const featuresSchema = z.object(
  Object.fromEntries(Object.values(FEATURES).map((key) => [key, z.boolean().optional()])),
);

const notificationSettingsSchema = z.object({
  emailEnabled: z.boolean().optional(),
  bookingEmails: z.boolean().optional(),
  applicationEmails: z.boolean().optional(),
  reviewEmails: z.boolean().optional(),
  payoutEmails: z.boolean().optional(),
  announcementEmails: z.boolean().optional(),
});

export const platformSettingsSchema = z
  .object({
    commissionPercent: z.coerce.number().min(0).max(50).optional(),
    freeCancellationWindowHours: z.coerce.number().int().min(0).max(168).optional(),
    lateCancellationRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    studentNoShowRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    tutorNoShowRefundPercent: z.coerce.number().int().min(0).max(100).optional(),
    cancellationAbuseThreshold: z.coerce.number().int().min(1).max(20).optional(),
    cancellationAbuseWindowDays: z.coerce.number().int().min(1).max(365).optional(),
    minimumBookingNoticeHours: z.coerce.number().int().min(0).max(168).optional(),
    bookingHorizonDays: z.coerce.number().int().min(1).max(365).optional(),
    minHourlyRate: z.coerce.number().int().min(0).max(500).optional(),
    maxHourlyRate: z.coerce.number().int().min(1).max(1000).optional(),
    payoutHoldDays: z.coerce.number().int().min(0).max(60).optional(),
    defaultSearchRadiusKm: z.coerce.number().int().min(1).max(500).optional(),
    autoModerateReviews: z.boolean().optional(),

    branding: brandingSchema.optional(),
    theme: themeSchema.optional(),
    seo: seoSchema.optional(),
    contact: contactSchema.optional(),
    social: socialSchema.optional(),
    footer: footerSchema.optional(),
    features: featuresSchema.optional(),
    notifications: notificationSettingsSchema.optional(),
  })
  // Unknown keys are dropped rather than rejected — `updatedBy`, `key` and the
  // timestamps come back on every GET and a round-tripping form would resend
  // them. Uploaded asset records are dropped the same way: they can only be
  // written through the upload route, never through this one.
  .strip()
  .refine(
    (v) => v.minHourlyRate === undefined || v.maxHourlyRate === undefined || v.minHourlyRate < v.maxHourlyRate,
    { message: "The minimum rate must be below the maximum.", path: ["minHourlyRate"] },
  );

/** Which asset an upload is for. The file itself is validated from its bytes. */
export const brandingAssetSchema = z.object({
  asset: z.enum(BRANDING_ASSET_KEYS),
});

/** Guard against a settings PATCH that names a group we cannot store. */
export const SETTINGS_GROUP_KEYS = SETTINGS_GROUPS;

// --- Curriculum management (§24 admin, §13) ---

export const provinceSchema = z.object({
  code: provinceCode,
  name: z.string().trim().min(2).max(60),
  isActive: z.boolean().default(false),
  usesCourseCodes: z.boolean().default(false),
  courseCodeHint: z.string().trim().max(120).optional(),
  displayOrder: z.coerce.number().int().min(0).max(100).default(0),
});

export const gradeSchema = z.object({
  provinceId: objectId,
  name: z.string().trim().min(1).max(40),
  level: z.coerce.number().int().min(0).max(13),
  stage: z.enum(["ELEMENTARY", "MIDDLE", "SECONDARY"]),
  isActive: z.boolean().default(true),
});

export const subjectSchema = z.object({
  name: z.string().trim().min(2).max(60),
  shortName: z.string().trim().max(30).optional(),
  description: z.string().trim().max(400).optional(),
  icon: z.string().trim().max(40).optional(),
  colorKey: z.string().trim().max(20).optional(),
  isPopular: z.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).max(200).default(0),
  isActive: z.boolean().default(true),
});

export const courseSchema = z.object({
  provinceId: objectId,
  gradeId: objectId,
  subjectId: objectId,
  name: z.string().trim().min(2).max(120),
  code: courseCode.optional().or(z.literal("").transform(() => undefined)),
  description: z.string().trim().max(600).optional(),
  credits: z.coerce.number().min(0).max(10).optional(),
  stream: z.string().trim().max(40).optional(),
  isPopular: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});
