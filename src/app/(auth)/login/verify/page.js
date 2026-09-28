import { redirect } from "next/navigation";
import { LoginVerification } from "@/components/auth/LoginVerification";
import { readLoginChallengeCookie } from "@/lib/auth/session";
import { describeLoginChallenge } from "@/services/login-verification.service";
import { developmentMailboxEnabled } from "@/services/external/email-provider";

export const metadata = {
  title: "Confirm it's you",
  description: "Enter the code we emailed to finish signing in on a new device.",
  robots: { index: false, follow: false },
};

/**
 * The new-device sign-in code step (§9, §36).
 *
 * Reachable only with a live challenge — the httpOnly handle the sign-in
 * endpoint set after a correct password. Without one there is nothing to
 * verify, so the page sends the visitor to sign in instead.
 */
export default async function LoginVerifyPage() {
  const [challenge, devMailbox] = await Promise.all([
    readLoginChallengeCookie().then(describeLoginChallenge),
    developmentMailboxEnabled(),
  ]);
  if (!challenge) redirect("/login");

  return <LoginVerification challenge={challenge} devMailbox={devMailbox} />;
}
