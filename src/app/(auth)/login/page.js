import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { Spinner } from "@/components/ui";
import { getAppConfig } from "@/services/settings.service";
import { enabledOAuthProviders } from "@/lib/auth/oauth-availability";

export async function generateMetadata() {
  const { branding } = await getAppConfig();
  return {
    title: "Sign in",
    description: `Sign in to your ${branding.appName} account to manage lessons, messages and payments.`,
    robots: { index: false, follow: true },
  };
}

export default async function LoginPage() {
  const { features } = await getAppConfig();
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
        Welcome back
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Don&rsquo;t have an account?{" "}
        <Link href="/register" className="font-semibold text-brand-600 hover:underline">
          Create one
        </Link>
      </p>

      <Suspense fallback={<Spinner className="mt-8" />}>
        <LoginForm oauthProviders={enabledOAuthProviders(features)} />
      </Suspense>
    </>
  );
}
