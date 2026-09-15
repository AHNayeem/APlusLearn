import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/PasswordForms";

export const metadata = {
  title: "Reset your password",
  description: "Request a password reset link for your APlus Learn account.",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
        Reset your password
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        Enter the email you signed up with and we&rsquo;ll send you a link to choose a new password.
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-sm text-ink-500">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
