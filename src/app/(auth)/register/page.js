import Link from "next/link";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { Spinner } from "@/components/ui";

export const metadata = {
  title: "Create an account",
  description:
    "Create a free APlus Learn account to message tutors, book lessons and track your child's progress.",
  robots: { index: true, follow: true },
};

export default function RegisterPage() {
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
        <RegisterForm />
      </Suspense>
    </>
  );
}
