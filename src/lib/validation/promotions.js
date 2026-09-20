import { z } from "zod";
import { PROMOTION_STATUS } from "@/constants";
import { objectId } from "./common";

/**
 * Promoted tutor profiles (§41 Phase 2).
 *
 * An administrator supplies intent — which tutor, for how long, and why.
 * Everything that decides whether the promotion is allowed to exist at all,
 * and everything about its effect on discovery, is derived server-side from
 * the tutor's own state and platform settings (§42). There is no field here
 * for a status, a rank or a boost, because none of those is the client's to
 * state.
 */

export const createPromotionSchema = z.object({
  tutorProfileId: objectId,
  /** Absent means "start now". */
  startsAt: z.iso.datetime({ offset: true }).optional(),
  /** Absent means "run for the platform's default window". */
  endsAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Lifecycle transitions.
 *
 * Expressed as named actions rather than as a settable `status`, so the
 * server owns which moves are legal. `EXTEND` is the only one that carries a
 * date, and it may only move the end of the window.
 */
export const promotionActionSchema = z
  .object({
    action: z.enum(["ACTIVATE", "PAUSE", "EXTEND", "CANCEL"]),
    endsAt: z.iso.datetime({ offset: true }).optional(),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.action !== "EXTEND" || !!v.endsAt, {
    message: "Choose the new end date.",
    path: ["endsAt"],
  });

export const promotionQuerySchema = z.object({
  status: z.enum(Object.values(PROMOTION_STATUS)).optional(),
  tutorProfileId: objectId.optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});
