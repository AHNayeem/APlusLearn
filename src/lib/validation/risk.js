import { z } from "zod";
import { RISK_CASE_STATUS, RISK_LEVELS, RISK_ACTIONS } from "@/constants";
import { objectId } from "./common";

/**
 * Fraud and risk review (§41 Phase 2).
 *
 * Nothing a client can send here sets a level, a score or a status directly.
 * The score is derived from the stored signals, the level from the score
 * against platform settings, and the status only moves through the named
 * transitions below — so `riskLevel`, `fraudConfirmed` and friends are not
 * fields a request can carry at all (§42).
 */

export const riskCaseQuerySchema = z.object({
  status: z.enum(Object.values(RISK_CASE_STATUS)).optional(),
  level: z.enum(Object.values(RISK_LEVELS)).optional(),
  subjectUserId: objectId.optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * A review action.
 *
 * `RESOLVE` carries the conclusion and, optionally, a record of what was done
 * about it. Applying a restriction is a separate, deliberate act through user
 * management — `action` here records that it happened, it does not perform it.
 */
export const riskCaseActionSchema = z
  .object({
    action: z.enum(["REVIEW", "RESOLVE"]),
    resolution: z.enum([RISK_CASE_STATUS.CONFIRMED, RISK_CASE_STATUS.CLEARED]).optional(),
    outcome: z.enum(Object.values(RISK_ACTIONS)).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.action !== "RESOLVE" || !!v.resolution, {
    message: "Say whether this is confirmed or cleared.",
    path: ["resolution"],
  })
  .refine(
    (v) =>
      v.action !== "RESOLVE" ||
      v.resolution !== RISK_CASE_STATUS.CONFIRMED ||
      (v.note?.trim().length ?? 0) >= 10,
    { message: "Record why this was confirmed.", path: ["note"] },
  );
