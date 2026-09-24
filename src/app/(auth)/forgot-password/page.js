import { PasswordResetFlow } from "@/components/auth/PasswordForms";
import { readPasswordResetCookie } from "@/lib/auth/session";
import { describePasswordResetRequest } from "@/services/password-reset.service";
import { developmentMailboxEnabled } from "@/services/external/email-provider";

export const metadata = {
  title: "Reset your password",
  description: "Get a verification code to choose a new password for your APlus Learn account.",
  robots: { index: false, follow: true },
};

/**
 * The whole forgot-password flow lives on this one page (§9).
 *
 * A request already in progress — the httpOnly handle is still valid — opens
 * straight on the code step, so a refresh or a detour to the inbox does not
 * send the person back to the start and void the code they were sent.
 */
export default async function ForgotPasswordPage() {
  const [pendingRequest, devMailbox] = await Promise.all([
    readPasswordResetCookie().then(describePasswordResetRequest),
    developmentMailboxEnabled(),
  ]);

  return <PasswordResetFlow pendingRequest={pendingRequest} devMailbox={devMailbox} />;
}
