"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, ApiError } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { passwordIssues } from "@/lib/auth/password-policy";
import {
  Alert, Button, Field, Input, PasswordInput, FormErrorSummary, Spinner, SuccessState,
} from "@/components/ui";

/**
 * Forgot password (§9): email → emailed code → new password → sign in.
 *
 * Every step is decided by the server. The browser never holds the request
 * handle (it is an httpOnly cookie), never decides a code was right, and
 * reaches the password step only with the single-use authorisation the
 * server exchanged a correct code for. A refreshed page resumes at the code
 * step because the server read the cookie, not because this component
 * remembered anything.
 */
export function PasswordResetFlow({ pendingRequest = null, devMailbox = false }) {
  const [step, setStep] = useState(pendingRequest ? "code" : "email");
  const [request, setRequest] = useState(() => withDeadlines(pendingRequest));
  const [resetToken, setResetToken] = useState(null);
  const [notice, setNotice] = useState(null);

  // Move focus to the new heading when the step changes, so a screen reader
  // announces where the person now is. Not on first paint: that belongs to
  // the page.
  const headingRef = useRef(null);
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const restart = (message = null) => {
    setNotice(message);
    setResetToken(null);
    setStep("email");
  };

  const heading = {
    email: ["Forgot your password?", "Enter your account email and we’ll send you a 6-digit verification code."],
    code: ["Check your email", null],
    password: ["Create a new password", "You’ll be signed out on every device once it’s changed."],
    done: [null, null],
  }[step];

  return (
    <>
      {heading[0] && (
        <>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-2xl font-extrabold tracking-tight text-ink-900 outline-none sm:text-3xl"
          >
            {heading[0]}
          </h1>
          {heading[1] && <p className="mt-2 text-sm text-ink-500">{heading[1]}</p>}
        </>
      )}

      {step === "email" && (
        <RequestCodeStep
          notice={notice}
          onSent={(state) => {
            setNotice(null);
            setRequest(withDeadlines(state));
            setStep("code");
          }}
        />
      )}

      {step === "code" && request && (
        <VerifyCodeStep
          request={request}
          devMailbox={devMailbox}
          onResent={(state) => setRequest(withDeadlines(state))}
          onCooldown={(seconds) =>
            setRequest((current) => ({ ...current, resendAt: Date.now() + seconds * 1000 }))
          }
          onVerified={(token) => {
            setResetToken(token);
            setStep("password");
          }}
          onRestart={restart}
        />
      )}

      {step === "password" && resetToken && (
        <NewPasswordStep token={resetToken} onDone={() => setStep("done")} onRestart={restart} />
      )}

      {step === "done" ? (
        <SuccessState
          className="mt-2"
          title="Password updated"
          description="You’ve been signed out on every device. Sign in with your new password."
          action={
            <Button href="/login?reset=1" size="lg">
              Sign in
            </Button>
          }
        />
      ) : (
        <p className="mt-6 text-sm text-ink-500">
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      )}
    </>
  );
}

/** Server durations → local deadlines, so the countdown ignores clock skew. */
function withDeadlines(state) {
  if (!state) return null;
  const now = Date.now();
  return {
    ...state,
    resendAt: now + (state.resendInSeconds ?? 0) * 1000,
    expiresAt: now + (state.codeExpiresInSeconds ?? 0) * 1000,
  };
}

function RequestCodeStep({ notice, onSent }) {
  const [email, setEmail] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const state = await api.post("/api/auth/forgot-password", { email });
    onSent(state);
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-8 space-y-5"
      noValidate
    >
      {notice && !error && <Alert tone="warning">{notice}</Alert>}
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />
      <Field label="Email address" htmlFor="forgot-email" error={fieldErrors.email} required>
        <Input
          id="forgot-email"
          name="email"
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
      <Button type="submit" size="lg" fullWidth loading={pending} disabled={!email.trim()}>
        Send code
      </Button>
    </form>
  );
}

function VerifyCodeStep({ request, devMailbox, onResent, onCooldown, onVerified, onRestart }) {
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const inputRef = useRef(null);

  // One tick a second drives both countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resendIn = Math.max(0, Math.ceil((request.resendAt - now) / 1000));
  const expired = now >= request.expiresAt;

  const verify = useSubmit(
    async (value) => {
      const result = await api.post("/api/auth/forgot-password/verify", { code: value });
      onVerified(result.resetToken);
    },
    {
      onError: () => {
        // Whatever went wrong, the digits on screen are no longer worth
        // keeping — start the next attempt from an empty box.
        setCode("");
        inputRef.current?.focus();
      },
    },
  );

  const resend = useSubmit(
    async () => {
      const state = await api.post("/api/auth/forgot-password/resend");
      setCode("");
      setResent(true);
      onResent(state);
      inputRef.current?.focus();
    },
    {
      onError: (err) => {
        if (err?.code === "RESEND_COOLDOWN" && err.details?.retryAfterSeconds) {
          onCooldown(err.details.retryAfterSeconds);
        }
        if (err?.code === "RESET_REQUEST_EXPIRED") {
          onRestart("Your reset request expired. Enter your email to get a new code.");
        }
      },
    },
  );

  const busy = verify.pending || resend.pending;

  return (
    <div className="mt-2">
      <p className="text-sm text-ink-500">
        If an account exists for <strong className="text-ink-800">{request.maskedEmail}</strong>,
        we&rsquo;ve sent it a 6-digit code. The code expires in {request.expiresInMinutes} minutes.
      </p>

      {devMailbox && (
        <Alert tone="info" title="Development mode" className="mt-5">
          No mail server is configured, so nothing was emailed. The code is printed in the server
          log and kept in the{" "}
          <a
            href="/dev/mail"
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline"
          >
            development mailbox
          </a>
          . This notice never appears in production.
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length === 6) verify.submit(code);
        }}
        className="mt-6 space-y-5"
        noValidate
      >
        <FormErrorSummary error={verify.error ?? resend.error} fieldErrors={{}} />
        {resent && !verify.error && !resend.error && (
          <Alert tone="success">A new code is on its way. Any earlier code no longer works.</Alert>
        )}
        {expired && !verify.error && (
          <Alert tone="warning">This verification code has expired. Please request a new code.</Alert>
        )}

        <Field
          label="Verification code"
          htmlFor="reset-code"
          hint="Enter the 6 digits from the email."
          error={verify.fieldErrors.code}
          required
        >
          {(aria) => (
            <Input
              {...aria}
              ref={inputRef}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              autoFocus
              required
              // Read-only rather than disabled while a request is out, so
              // focus can return to the box the moment it comes back.
              readOnly={busy}
              value={code}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(digits);
                // A full code — typed or pasted — submits itself.
                if (digits.length === 6 && !busy) verify.submit(digits);
              }}
              error={verify.fieldErrors.code}
              placeholder="••••••"
              className="text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
            />
          )}
        </Field>

        <Button
          type="submit"
          size="lg"
          fullWidth
          loading={verify.pending}
          disabled={code.length !== 6 || resend.pending}
        >
          Verify code
        </Button>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
        <span>
          Didn&rsquo;t get it?{" "}
          <button
            type="button"
            onClick={() => resend.submit()}
            disabled={resendIn > 0 || busy}
            className="font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline"
          >
            {resend.pending ? "Sending…" : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
        </span>
        <button
          type="button"
          onClick={() => onRestart()}
          className="font-semibold text-ink-600 hover:text-ink-900 hover:underline"
        >
          Use a different email
        </button>
      </div>
    </div>
  );
}

const PASSWORD_RULES = [
  "Use at least 10 characters",
  "Include a lowercase letter",
  "Include an uppercase letter",
  "Include a number",
];

function NewPasswordStep({ token, onDone, onRestart }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [expired, setExpired] = useState(false);

  const { submit, pending, error, fieldErrors } = useSubmit(
    async () => {
      await api.post("/api/auth/reset-password", { token, password, confirmPassword });
      onDone();
    },
    { onError: (err) => setExpired(err?.code === "RESET_EXPIRED") },
  );

  if (expired) {
    return (
      <Alert
        tone="warning"
        title="Your reset session has expired"
        className="mt-8"
        action={
          <Button size="sm" variant="secondary" onClick={() => onRestart()}>
            Start again
          </Button>
        }
      >
        For your security, a verified code is good for a few minutes and once only. Request a new
        code to continue.
      </Alert>
    );
  }

  const issues = passwordIssues(password);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="mt-8 space-y-5"
      noValidate
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />

      <Field label="New password" htmlFor="new-password" error={fieldErrors.password} required>
        <PasswordInput
          id="new-password"
          name="password"
          autoComplete="new-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          iconLeft={<Lock className="size-4" />}
        />
        {password.length > 0 && (
          <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-live="polite">
            {PASSWORD_RULES.map((rule) => {
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
        error={fieldErrors.confirmPassword ?? (mismatch ? "Passwords do not match." : undefined)}
        required
      >
        <PasswordInput
          id="confirm-new-password"
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={fieldErrors.confirmPassword ?? mismatch}
          iconLeft={<Lock className="size-4" />}
        />
      </Field>

      <Button type="submit" size="lg" fullWidth loading={pending}>
        Reset password
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
