import { redirect } from "next/navigation";

/**
 * Password reset used to arrive here from an emailed link. It is now a code
 * typed into `/forgot-password`, so anything still pointing at this address —
 * a bookmark, an old email — lands on the one flow there is.
 */
export default function ResetPasswordPage() {
  redirect("/forgot-password");
}
