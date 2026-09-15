import { z } from "zod";
import { ROLES } from "@/constants";
import { email, password, personName, phone, provinceCode } from "./common";

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
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
  next: z.string().max(300).optional(),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, "That reset link is not valid."),
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
 * OAuth sign-in. The provider's identity payload is verified server-side by
 * the auth provider abstraction before this schema is applied (§9, §38).
 */
export const oauthSignInSchema = z.object({
  provider: z.enum(["GOOGLE", "APPLE"]),
  credential: z.string().min(8, "The sign-in response was incomplete."),
  /**
   * Only honoured when creating a brand-new account. An existing user's role
   * is never changed by a social sign-in — see `oauthSignIn` (§10).
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
  next: z.string().max(300).optional(),
});
