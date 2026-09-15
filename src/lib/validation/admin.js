import { z } from "zod";
import { ROLES, USER_STATUS, TUTOR_STATUS, PAYOUT_STATUS } from "@/constants";
import { objectId, cents, provinceCode, courseCode } from "./common";

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

export const platformSettingsSchema = z.object({
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
});

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
