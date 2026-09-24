"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, ApiError } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { passwordIssues } from "@/lib/auth/password-policy";
import {
  Alert, Button, Field, Input, FormErrorSummary, Spinner, SuccessState, ErrorState,
} from "@/components/ui";

/** Request a reset link (§9). */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post("/api/auth/forgot-password", { email });
    setSent(true);
  });

  if (sent) {
    return (
      <Alert tone="success" title="Check your inbox" className="mt-8">
        If an account exists for <strong>{email}</strong>, we&rsquo;ve sent a reset link. It expires
        in one hour.
        <p className="mt-2 text-xs">
          In development the link is printed to the server console instead of being emailed.
        </p>
      </Alert>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-8 space-y-5"
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />
      <Field label="Email address" htmlFor="forgot-email" error={fieldErrors.email} required>
        <Input
          id="forgot-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          iconLeft={<Mail className="size-4" />}
          placeholder="you@example.com"
        />
      </Field>
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Send reset link
      </Button>
    </form>
  );
}

/** Set a new password from an emailed token. */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/auth/reset-password", {
      token,
      password,
      confirmPassword,
    });
    router.push(result.redirectTo);
    router.refresh();
    return result;
  });

  if (!token) {
    return (
      <ErrorState
        className="mt-8"
        title="That link isn't valid"
        description="Reset links expire after an hour. Request a new one to continue."
        retryHref="/forgot-password"
      />
    );
  }

  const issues = passwordIssues(password);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-8 space-y-5"
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />

      <Field label="New password" htmlFor="new-password" error={fieldErrors.password} required>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          iconLeft={<Lock className="size-4" />}
        />
        {password.length > 0 && (
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
        label="Confirm new password"
        htmlFor="confirm-new-password"
        error={fieldErrors.confirmPassword}
        required
      >
        <Input
          id="confirm-new-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword}
          iconLeft={<Lock className="size-4" />}
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={pending}>
        Update password and sign in
      </Button>
    </form>
  );
}

/** Consumes the emailed verification token (§9). */
export function VerifyEmailPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");

  const [state, setState] = useState(token ? "verifying" : "missing");
  const [message, setMessage] = useState("");
  const [redirectTo, setRedirectTo] = useState("/dashboard");
  const [resendEmail, setResendEmail] = useState("");
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    api
      .post("/api/auth/verify-email", { token })
      .then((result) => {
        if (cancelled) return;
        setRedirectTo(result.redirectTo);
        setState("verified");
        router.refresh();
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(error instanceof ApiError ? error.message : "That link could not be used.");
        setState("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [token, router]);

  if (state === "verifying") {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <Spinner className="size-7 text-brand-600" />
        <p className="mt-4 text-sm text-ink-500">Verifying your email…</p>
      </div>
    );
  }

  if (state === "verified") {
    return (
      <SuccessState
        title="Email verified"
        description="Your account is active. Welcome to APlus Learn."
        action={<Button href={redirectTo} size="lg">Go to my dashboard</Button>}
        secondaryAction={
          <Button href="/find-a-tutor" variant="secondary" size="lg">
            Find a tutor
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">
        {state === "missing" ? "Verify your email" : "That link has expired"}
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        {state === "missing"
          ? "Open the link we emailed you, or request a new one below."
          : message}
      </p>

      {resent ? (
        <Alert tone="success" title="Verification email sent" className="mt-6">
          Check your inbox for a fresh link. In development it&rsquo;s printed to the server console.
        </Alert>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await api.post("/api/auth/resend-verification", { email: resendEmail }).catch(() => {});
            setResent(true);
          }}
          className="mt-6 space-y-4"
        >
          <Field label="Email address" htmlFor="resend-email" required>
            <Input
              id="resend-email"
              type="email"
              required
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              iconLeft={<Mail className="size-4" />}
              placeholder="you@example.com"
            />
          </Field>
          <Button type="submit" size="lg" fullWidth>
            Send a new link
          </Button>
        </form>
      )}

      <p className="mt-6 text-sm text-ink-500">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
