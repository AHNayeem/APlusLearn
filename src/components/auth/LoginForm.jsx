"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Mail, Lock } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Button, Field, Input, Checkbox, FormErrorSummary, Alert } from "@/components/ui";
import { OAuthButtons } from "@/components/layout/OAuthButtons";

export function LoginForm({ oauthProviders }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/auth/login", { email, password, next: next ?? undefined });
    router.push(result.redirectTo);
    router.refresh();
    return result;
  });

  return (
    <div className="mt-8">
      {params.get("registered") && (
        <Alert tone="success" title="Account created" className="mb-5">
          Check your email for a verification link, then sign in below.
        </Alert>
      )}
      {params.get("reset") && (
        <Alert tone="success" title="Password updated" className="mb-5">
          Sign in with your new password.
        </Alert>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5"
      >
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="Email address" htmlFor="email" error={fieldErrors.email} required>
          <Input
            id="email"
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

        <Field label="Password" htmlFor="password" error={fieldErrors.password} required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            iconLeft={<Lock className="size-4" />}
            placeholder="••••••••••"
          />
        </Field>

        <div className="flex items-center justify-between">
          <Checkbox label="Keep me signed in" name="remember" defaultChecked />
          <Link
            href="/forgot-password"
            className="text-sm font-semibold text-brand-600 hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" fullWidth loading={pending}>
          Sign in
        </Button>
      </form>

      <OAuthButtons next={next} providers={oauthProviders} />
    </div>
  );
}
