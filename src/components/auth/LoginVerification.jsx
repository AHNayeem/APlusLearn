"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Alert, Button, Field, Input, FormErrorSummary } from "@/components/ui";

/**
 * The new-device sign-in code screen (§9, §36).
 *
 * Every decision is the server's. The browser never holds the challenge
 * handle (an httpOnly cookie), never decides a code was right, and is signed
 * in only by the session cookie the verify endpoint sets. A refresh resumes
 * here because the server read the cookie, not because this component
 * remembered anything.
 *
 * `challenge.devCode` exists only in a development build on a non-production
 * deployment; the server leaves it out everywhere else.
 */
export function LoginVerification({ challenge: initial, devMailbox = false }) {
  const router = useRouter();
  const [challenge, setChallenge] = useState(() => withDeadlines(initial));
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const [spent, setSpent] = useState(null);
  // Set once the code is accepted, so the screen stays still while the
  // dashboard loads rather than inviting a second submission.
  const [done, setDone] = useState(false);
  const inputRef = useRef(null);

  // One tick a second drives both countdowns.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const resendIn = Math.max(0, Math.ceil((challenge.resendAt - now) / 1000));
  const expired = now >= challenge.expiresAt;

  const verify = useSubmit(
    async (value) => {
      const result = await api.post("/api/auth/login/verify", { code: value });
      setDone(true);
      router.push(result.redirectTo);
      router.refresh();
      return result;
    },
    {
      onError: (err) => {
        // The attempt itself is over — back to the sign-in form, not a retry.
        if (err?.code === "LOGIN_CHALLENGE_EXPIRED") setSpent(err.message);
        // Whatever else went wrong, the digits on screen are no longer worth
        // keeping — start the next attempt from an empty box.
        setCode("");
        inputRef.current?.focus();
      },
    },
  );

  const resend = useSubmit(
    async () => {
      const state = await api.post("/api/auth/login/resend");
      setCode("");
      setResent(true);
      setChallenge(withDeadlines(state));
      inputRef.current?.focus();
    },
    {
      onError: (err) => {
        if (err?.code === "RESEND_COOLDOWN" && err.details?.retryAfterSeconds) {
          const seconds = err.details.retryAfterSeconds;
          setChallenge((current) => ({ ...current, resendAt: Date.now() + seconds * 1000 }));
        }
        if (err?.code === "LOGIN_CHALLENGE_EXPIRED") setSpent(err.message);
      },
    },
  );

  const busy = verify.pending || resend.pending;

  if (spent) {
    return (
      <Alert
        tone="warning"
        title="Please sign in again"
        className="mt-8"
        action={
          <Button href="/login" size="sm" variant="secondary">
            Back to sign in
          </Button>
        }
      >
        {spent}
      </Alert>
    );
  }

  return (
    <div>
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
        <ShieldCheck className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
        Confirm it&rsquo;s you
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        You&rsquo;re signing in from a device we don&rsquo;t recognise. We&rsquo;ve sent a 6-digit
        code to <strong className="text-ink-800">{challenge.maskedEmail}</strong>. It expires in{" "}
        {challenge.expiresInMinutes} minutes.
      </p>

      {challenge.devCode && (
        <DevCodeHelper
          code={challenge.devCode}
          devMailbox={devMailbox}
          disabled={busy || done}
          onUse={() => {
            setCode(challenge.devCode);
            verify.submit(challenge.devCode);
          }}
        />
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
          <Alert tone="warning">This sign-in code has expired. Please send a new code.</Alert>
        )}

        <Field
          label="Sign-in code"
          htmlFor="login-code"
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
              readOnly={busy || done}
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
          loading={verify.pending || done}
          disabled={code.length !== 6 || resend.pending}
        >
          Verify and sign in
        </Button>
      </form>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-ink-500">
        <span>
          Didn&rsquo;t get it?{" "}
          <button
            type="button"
            onClick={() => resend.submit()}
            disabled={resendIn > 0 || busy || done}
            className="font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed disabled:text-ink-400 disabled:no-underline"
          >
            {resend.pending ? "Sending…" : resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>
        </span>
        <Link href="/login" className="font-semibold text-ink-600 hover:text-ink-900 hover:underline">
          Use a different account
        </Link>
      </div>

      <p className="mt-6 text-xs text-ink-400">
        Once verified, this browser is remembered, so you won&rsquo;t be asked again here unless
        your password changes.
      </p>
    </div>
  );
}

/** Server durations → local deadlines, so the countdown ignores clock skew. */
function withDeadlines(state) {
  const now = Date.now();
  return {
    ...state,
    resendAt: now + (state.resendInSeconds ?? 0) * 1000,
    expiresAt: now + (state.codeExpiresInSeconds ?? 0) * 1000,
  };
}

/**
 * Development-only: the code the server just generated, so signing in needs
 * no mail transport. The server sends `devCode` only from a development build
 * on a non-production deployment, so this never renders in production.
 */
function DevCodeHelper({ code, devMailbox, disabled, onUse }) {
  return (
    <div className="mt-5 rounded-xl border border-dashed border-ink-300 bg-ink-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        Development &middot; sign-in code
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <output
          aria-label="Development sign-in code"
          className="font-mono text-2xl font-bold tracking-[0.3em] text-ink-900"
        >
          {code}
        </output>
        <Button type="button" size="xs" variant="secondary" disabled={disabled} onClick={onUse}>
          Use this code
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-500">
        The same code was {devMailbox ? (
          <>
            sent to the{" "}
            <a href="/dev/mail" target="_blank" rel="noreferrer" className="font-semibold underline">
              development mailbox
            </a>
          </>
        ) : (
          "emailed through the configured provider"
        )}
        . It is checked exactly like a real one; this box never appears in production.
      </p>
    </div>
  );
}
