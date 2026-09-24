"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, User, Check, Gift } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { passwordIssues } from "@/lib/auth/password-policy";
import { internalPath } from "@/lib/utils/url";
import {
  Button, Field, Input, Checkbox, OptionCard, FormErrorSummary,
} from "@/components/ui";
import { OAuthButtons } from "@/components/layout/OAuthButtons";
import { OAuthErrorNotice } from "./OAuthErrorNotice";
import { ROLES } from "@/constants";

const ACCOUNT_TYPES = [
  {
    value: ROLES.PARENT,
    label: "I'm a parent",
    description: "Book lessons for one or more children",
  },
  {
    value: ROLES.STUDENT,
    label: "I'm a student",
    description: "Book lessons for myself",
  },
  {
    value: ROLES.TUTOR,
    label: "I want to tutor",
    description: "Apply to teach on APlus Learn",
  },
];

export function RegisterForm({ oauthProviders }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const [form, setForm] = useState({
    role: params.get("role") ?? ROLES.PARENT,
    firstName: "",
    lastName: "",
    // The footer's newsletter field hands the address over here; it is still
    // validated server-side like any other submitted value.
    email: params.get("email")?.slice(0, 254) ?? "",
    password: "",
    confirmPassword: "",
    acceptTerms: false,
    marketingOptIn: false,
    // A referral link carries the code in the query string (§41 Phase 2).
    // An unknown or mistyped code is ignored server-side rather than refused,
    // so this never stands between somebody and an account.
    referralCode: params.get("ref")?.slice(0, 16).toUpperCase() ?? "",
  });

  const [referral, setReferral] = useState(null);

  const set = (key) => (event) =>
    setForm((f) => ({
      ...f,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));

  // Confirm the code belongs to somebody, so a mistyped one is noticed before
  // the account exists rather than silently earning nobody anything.
  //
  // The answer is stored with the code it was for, and only rendered when the
  // two still agree — that keeps the effect free of a synchronous state write
  // and stops a slow reply describing a code that has since been retyped.
  useEffect(() => {
    const code = form.referralCode.trim();
    if (code.length < 4) return undefined;

    let cancelled = false;
    api
      .get(`/api/referrals/code/${encodeURIComponent(code)}`)
      .then((data) => {
        if (!cancelled) setReferral({ code, ...data });
      })
      .catch(() => {
        if (!cancelled) setReferral({ code, valid: false });
      });

    return () => {
      cancelled = true;
    };
  }, [form.referralCode]);

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/auth/register", {
      ...form,
      referralCode: form.referralCode.trim() || undefined,
    });
    router.push(internalPath(next) ?? result.redirectTo);
    router.refresh();
    return result;
  });

  const issues = passwordIssues(form.password);

  // Only trust the lookup while it still describes what is in the field.
  const checkedReferral =
    referral && referral.code === form.referralCode.trim() ? referral : null;

  return (
    <div className="mt-8">
      <OAuthErrorNotice />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5"
      >
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <fieldset>
          <legend className="mb-2 block text-sm font-semibold text-ink-800">
            What brings you here?
          </legend>
          <div className="grid gap-2">
            {ACCOUNT_TYPES.map((type) => (
              <OptionCard
                key={type.value}
                type="radio"
                name="role"
                value={type.value}
                checked={form.role === type.value}
                onChange={set("role")}
                selected={form.role === type.value}
                label={type.label}
                description={type.description}
              />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={fieldErrors.firstName} required>
            <Input
              id="firstName"
              autoComplete="given-name"
              required
              value={form.firstName}
              onChange={set("firstName")}
              error={fieldErrors.firstName}
              iconLeft={<User className="size-4" />}
            />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={fieldErrors.lastName} required>
            <Input
              id="lastName"
              autoComplete="family-name"
              required
              value={form.lastName}
              onChange={set("lastName")}
              error={fieldErrors.lastName}
            />
          </Field>
        </div>

        <Field
          label="Email address"
          htmlFor="reg-email"
          error={fieldErrors.email}
          hint="We'll send a verification link here."
          required
        >
          <Input
            id="reg-email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set("email")}
            error={fieldErrors.email}
            iconLeft={<Mail className="size-4" />}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" htmlFor="reg-password" error={fieldErrors.password} required>
          <Input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            required
            value={form.password}
            onChange={set("password")}
            error={fieldErrors.password}
            iconLeft={<Lock className="size-4" />}
          />
          {form.password.length > 0 && (
            <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-live="polite">
              {[
                "Use at least 10 characters",
                "Include a lowercase letter",
                "Include an uppercase letter",
                "Include a number",
              ].map((rule) => {
                const met = !issues.includes(rule);
                return (
                  <li
                    key={rule}
                    className={cn(
                      "flex items-center gap-1.5 text-xs",
                      met ? "text-success-700" : "text-ink-400",
                    )}
                  >
                    <Check className={cn("size-3", !met && "opacity-30")} />
                    {rule}
                  </li>
                );
              })}
            </ul>
          )}
        </Field>

        <Field
          label="Confirm password"
          htmlFor="confirmPassword"
          error={fieldErrors.confirmPassword}
          required
        >
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={form.confirmPassword}
            onChange={set("confirmPassword")}
            error={fieldErrors.confirmPassword}
            iconLeft={<Lock className="size-4" />}
          />
        </Field>

        <Field
          label="Referral code"
          htmlFor="referralCode"
          hint="Optional — if a friend gave you one."
          error={fieldErrors.referralCode}
        >
          <Input
            id="referralCode"
            autoComplete="off"
            maxLength={16}
            value={form.referralCode}
            onChange={(e) =>
              setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase().trim() }))
            }
            error={fieldErrors.referralCode}
            iconLeft={<Gift className="size-4" />}
            placeholder="ABCD2345"
          />
          {checkedReferral?.valid && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-success-700">
              <Check className="size-3.5" />
              {checkedReferral.referrerName} invited you.
            </p>
          )}
          {checkedReferral && !checkedReferral.valid && (
            <p className="mt-1.5 text-xs text-ink-500">
              We don&rsquo;t recognise that code. You can still create your account.
            </p>
          )}
        </Field>

        <div className="space-y-3">
          <Checkbox
            label="I agree to the Terms of Service and Privacy Policy"
            checked={form.acceptTerms}
            onChange={set("acceptTerms")}
            required
          />
          {fieldErrors.acceptTerms && (
            <p className="text-xs font-medium text-danger-600">{fieldErrors.acceptTerms}</p>
          )}
          <Checkbox
            label="Send me occasional tips and updates"
            description="Study guides and platform news. Unsubscribe any time."
            checked={form.marketingOptIn}
            onChange={set("marketingOptIn")}
          />
        </div>

        <Button type="submit" size="lg" fullWidth loading={pending}>
          {form.role === ROLES.TUTOR ? "Start my tutor application" : "Create account"}
        </Button>
      </form>

      <OAuthButtons role={form.role} next={next} from="register" providers={oauthProviders} />
    </div>
  );
}
