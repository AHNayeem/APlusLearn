import { z } from "zod";
import {
  PACKAGE_STATUS,
  PACKAGE_PURCHASE_STATUS,
  LESSON_MODES,
  LESSON_DURATIONS,
} from "@/constants";
import { objectId, cents } from "./common";

/**
 * Tutor packages (§41 Phase 2).
 *
 * The tutor sets a title, a course, a size and a price. Everything else — the
 * per-session figures, the commission split, the effective hourly rate, the
 * saving — is derived server-side from those, so a request can never state
 * what a package is worth (§42).
 */

const packageBody = {
  title: z.string().trim().min(3, "Give the package a name.").max(120),
  description: z.string().trim().max(1000).optional(),
  sessionCount: z.coerce.number().int().min(1).max(100),
  sessionDurationMinutes: z.coerce
    .number()
    .int()
    .refine((v) => LESSON_DURATIONS.includes(v), "Choose one of the standard lesson lengths."),
  mode: z.enum(Object.values(LESSON_MODES)).default(LESSON_MODES.ONLINE),
  priceCents: cents,
  validityDays: z.coerce.number().int().min(1).max(730).optional(),
};

export const createPackageSchema = z.object({
  ...packageBody,
  courseId: objectId,
});

/**
 * Editing an offer. The course is absent: a package for a different course is
 * a different package, and somebody may already have bought this one.
 */
export const updatePackageSchema = z.object({
  title: packageBody.title.optional(),
  description: packageBody.description,
  sessionCount: packageBody.sessionCount.optional(),
  sessionDurationMinutes: packageBody.sessionDurationMinutes.optional(),
  priceCents: cents.optional(),
  validityDays: packageBody.validityDays,
});

export const packageStatusSchema = z.object({
  status: z.enum([PACKAGE_STATUS.DRAFT, PACKAGE_STATUS.ACTIVE, PACKAGE_STATUS.PAUSED, PACKAGE_STATUS.ARCHIVED]),
});

export const purchasePackageSchema = z.object({
  packageId: objectId,
  studentProfileId: objectId,
});

export const cancelPurchaseSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

export const purchaseQuerySchema = z.object({
  status: z.enum(Object.values(PACKAGE_PURCHASE_STATUS)).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const usablePackageQuerySchema = z.object({
  tutorProfileId: objectId,
  courseId: objectId,
  durationMinutes: z.coerce.number().int().min(15).max(240).optional(),
  mode: z.enum(Object.values(LESSON_MODES)).optional(),
});
