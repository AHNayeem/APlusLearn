import { Suspense } from "react";
import { VerifyEmailPanel } from "@/components/auth/PasswordForms";
import { Spinner } from "@/components/ui";

export const metadata = {
  title: "Verify your email",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <VerifyEmailPanel />
    </Suspense>
  );
}
