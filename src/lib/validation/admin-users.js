import { z } from "zod";

/**
 * Administrative actions on an account (§24, R28.2).
 *
 * Every action that changes whether somebody can use the platform — suspend,
 * ban, restore, delete — carries a reason, because it is stored on the account
 * and in the audit log, and "why was I locked out" is a question support has
 * to be able to answer. Verifying an email and forcing a sign-out change
 * nothing about access and need none.
 */
export const ADMIN_USER_ACTIONS = ["SUSPEND", "BAN", "REINSTATE", "VERIFY_EMAIL", "FORCE_LOGOUT", "DELETE"];

const ACTIONS_NEEDING_REASON = ["SUSPEND", "BAN", "REINSTATE", "DELETE"];

export const adminAccountActionSchema = z
  .object({
    action: z.enum(ADMIN_USER_ACTIONS),
    reason: z.string().trim().max(600).optional(),
  })
  .refine((d) => !ACTIONS_NEEDING_REASON.includes(d.action) || (d.reason?.length ?? 0) >= 10, {
    message: "Record a reason of at least 10 characters.",
    path: ["reason"],
  });

/** The independently paged history panels on an account's detail (R28.3). */
export const adminUserDetailQuerySchema = z.object({
  bookingsPage: z.coerce.number().int().min(1).max(500).default(1),
  paymentsPage: z.coerce.number().int().min(1).max(500).default(1),
  conversationsPage: z.coerce.number().int().min(1).max(500).default(1),
});
