import { z } from "zod";
import {
  PROGRESS_REPORT_STATUS,
  PROGRESS_RATINGS,
  GOAL_PROGRESS,
} from "@/constants";
import { objectId, isoDate } from "./common";

/**
 * Progress reports (§41 Phase 2).
 *
 * The status, the lessons covered, the period and the learner are all absent
 * from every write schema on purpose: each is derived server-side from what
 * actually happened, and a request that named them would be a request that
 * could claim teaching that never took place (§42).
 */

export const createProgressReportSchema = z.object({
  studentProfileId: objectId,
  courseId: objectId.optional(),
  periodStart: isoDate.optional(),
  periodEnd: isoDate.optional(),
});

const ratingScale = z.coerce.number().int().min(1).max(5);

const goalProgressSchema = z.object({
  goalId: objectId.optional(),
  label: z.string().trim().min(2, "Give the goal a name.").max(200),
  status: z.enum(Object.values(GOAL_PROGRESS)).default(GOAL_PROGRESS.IN_PROGRESS),
  note: z.string().trim().max(500).optional(),
});

const milestoneSchema = z.object({
  label: z.string().trim().min(2, "Describe the milestone.").max(200),
  achievedAt: isoDate.optional(),
});

export const updateProgressReportSchema = z.object({
  summary: z.string().trim().max(3000).optional(),
  strengths: z.string().trim().max(2000).optional(),
  focusAreas: z.string().trim().max(2000).optional(),
  homework: z.string().trim().max(2000).optional(),
  ratings: z
    .object(
      Object.fromEntries(
        Object.values(PROGRESS_RATINGS).map((key) => [key, ratingScale.optional()]),
      ),
    )
    .optional(),
  goals: z.array(goalProgressSchema).max(20).optional(),
  milestones: z.array(milestoneSchema).max(20).optional(),
  /** Only ever seen by the tutor who wrote it. */
  privateNote: z.string().trim().max(2000).optional(),
  /** Required in spirit when revising a shared report; recorded either way. */
  revisionReason: z.string().trim().max(300).optional(),
});

export const tutorReportQuerySchema = z.object({
  studentProfileId: objectId.optional(),
  status: z.enum(Object.values(PROGRESS_REPORT_STATUS)).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const ownerReportQuerySchema = z.object({
  studentProfileId: objectId.optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

export const adminReportQuerySchema = z.object({
  status: z.enum(Object.values(PROGRESS_REPORT_STATUS)).optional(),
  page: z.coerce.number().int().min(1).max(200).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});
