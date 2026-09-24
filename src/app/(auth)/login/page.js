import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { Spinner } from "@/components/ui";
import { getAppConfig } from "@/services/settings.service";
import { connectToDatabase } from "@/lib/db/connect";
import { offeredSignInMethods } from "@/services/external/oauth-provider";

export async function generateMetadata() {
  const { branding } = await getAppConfig();
  return {
    title: "Sign in",
    description: `Sign in to your ${branding.appName} account to manage lessons, messages and payments.`,
    robots: { index: false, follow: true },
  };
}

/**
 * Rendered per request: which social sign-in methods appear is read from the
 * Social sign-in module on every visit, so an administrator switching Google
 * or Apple on or off changes this page at once, with no deploy (§26).
 */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Without a connection the module resolves from the environment alone,
  // which is the documented fallback rather than an error.
  await connectToDatabase().catch(() => {});
  const oauthProviders = await offeredSignInMethods();
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
        <LoginForm oauthProviders={oauthProviders} />
      </Suspense>
    </>
  );
}
