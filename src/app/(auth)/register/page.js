import Link from "next/link";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { Spinner } from "@/components/ui";
import { getAppConfig } from "@/services/settings.service";
import { connectToDatabase } from "@/lib/db/connect";
import { offeredSignInMethods } from "@/services/external/oauth-provider";

export async function generateMetadata() {
  const { branding } = await getAppConfig();
  return {
    title: "Create an account",
    description: `Create a free ${branding.appName} account to message tutors, book lessons and track your child's progress.`,
    robots: { index: true, follow: true },
  };
}

/**
 * Rendered per request: which social sign-in methods appear is read from the
 * Social sign-in module on every visit, so an administrator switching Google
 * or Apple on or off changes this page at once, with no deploy (§26).
 */
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Without a connection the module resolves from the environment alone,
  // which is the documented fallback rather than an error.
  await connectToDatabase().catch(() => {});
  const oauthProviders = await offeredSignInMethods();
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
        Create your account
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Already have one?{" "}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>

      <Suspense fallback={<Spinner className="mt-8" />}>
        <RegisterForm oauthProviders={oauthProviders} />
      </Suspense>
    </>
  );
}
