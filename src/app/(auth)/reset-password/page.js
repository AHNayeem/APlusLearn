import { Suspense } from "react";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/PasswordForms";
import { Spinner } from "@/components/ui";

export const metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
        Choose a new password
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Signing in everywhere else will be ended once you set a new password.
      </p>
      <Suspense fallback={<Spinner className="mt-8" />}>
        <ResetPasswordForm />
      </Suspense>
      <p className="mt-6 text-sm text-ink-500">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
