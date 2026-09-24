import { z } from "zod";
import { ROLES } from "@/constants";
import { email, password, personName, phone, provinceCode } from "./common";
import { internalPath } from "@/lib/utils/url";

export const registerSchema = z
  .object({
    role: z.enum([ROLES.PARENT, ROLES.STUDENT, ROLES.TUTOR]),
    firstName: personName,
    lastName: personName,
    email,
    password,
    confirmPassword: z.string(),
    phone: phone.optional().or(z.literal("").transform(() => undefined)),
    provinceCode: provinceCode.optional(),
    city: z.string().trim().max(80).optional(),
    acceptTerms: z.literal(true, { message: "You must accept the terms to continue." }),
    marketingOptIn: z.boolean().default(false),
    /**
     * A referral code, if they arrived with one (§41 Phase 2).
     *
     * Deliberately lenient: an unknown or malformed code is ignored by the
     * service rather than refused here. Somebody mistyping a friend's code is
     * not a reason to stop them creating an account.
     */
    referralCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(16)
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Where to land after signing in.
 *
 * Sanitised here rather than at each call site, so every route that accepts a
 * `next` gets the same answer: anything that is not a path on this
 * application becomes `undefined`, and the caller falls back to the home the
 * person's role gives them. Silently dropping it is deliberate — a refusal
 * would turn a tampered link into a sign-in the person cannot complete.
 */
const nextPath = z
  .string()
  .max(300)
  .optional()
  .transform((value) => internalPath(value) ?? undefined);

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
  next: nextPath,
});

export const forgotPasswordSchema = z.object({ email });

/**
 * The emailed reset code. Spaces and dashes are forgiven — people paste
 * "123 456" out of a mail client — anything else is refused before the
 * service counts it as a guess.
 */
export const verifyResetCodeSchema = z.object({
  code: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code we sent you.")),
});

/**
 * Choosing the new password. `token` is the single-use authorisation a
 * correct code was exchanged for — never the code itself, and never a flag
 * the browser sets.
 */
export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, "Your reset session has expired. Request a new code.").max(200),
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const verifyEmailSchema = z.object({
  token: z.string().min(10, "That verification link is not valid."),
});

export const resendVerificationSchema = z.object({ email });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

/**
 * Starting a Google or Apple sign-in (§9).
 *
 * These arrive on a link the sign-in or registration page builds, so all of
 * them are under the visitor's control: `role` may never name an
 * administrator, `next` is reduced to a path on this application, and `from`
 * only decides which page an error is reported on. They are carried to the
 * callback inside the encrypted transaction cookie, not trusted from the
 * provider's redirect.
 */
export const oauthStartQuerySchema = z.object({
  role: z.enum([ROLES.PARENT, ROLES.STUDENT, ROLES.TUTOR]).optional(),
  next: nextPath,
  from: z.enum(["login", "register"]).catch("login").default("login"),
});

/**
 * The development sign-in identity (§38). Accepted only while
 * `signInAvailability()` reports a provider in development mode; real Google
 * and Apple sign-in use the authorization-code flow and never post here.
 */
export const oauthSignInSchema = z.object({
  provider: z.enum(["GOOGLE", "APPLE"]),
  credential: z.string().min(8, "The sign-in response was incomplete."),
  /**
   * Only honoured when creating a brand-new account. An existing user's role
   * is never changed by a social sign-in — see `signInWithIdentity` (§10).
   */
  role: z.enum([ROLES.PARENT, ROLES.STUDENT, ROLES.TUTOR]).optional(),
  /**
   * Apple sends the member's name exactly once, alongside the token rather
   * than inside it. It is used only to fill blanks on a new account.
   */
  profile: z
    .object({
      firstName: z.string().trim().max(60).optional(),
      lastName: z.string().trim().max(60).optional(),
    })
    .optional(),
  next: nextPath,
});

/**
 * Reading the development mailbox (§38). `to` narrows it to one recipient;
 * an empty filter from the page's search box means "everyone".
 */
export const devMailQuerySchema = z.object({
  to: email.optional().or(z.literal("").transform(() => undefined)),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
