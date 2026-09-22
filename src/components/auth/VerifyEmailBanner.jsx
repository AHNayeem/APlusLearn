"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Button } from "@/components/ui";

/**
 * Shown to a signed-in member whose email address is not confirmed (§9).
 *
 * Booking, paying, messaging, posting a request and leaving a review are all
 * gated on verification server-side. A gate the person cannot see is a dead
 * end, so this says what is blocked and gives them the way out of it in one
 * click. It is a prompt, not a control: nothing here grants access.
 */
export function VerifyEmailBanner({ email }) {
  const [sent, setSent] = useState(false);

  const { submit, pending, error } = useSubmit(async () => {
    await api.post("/api/auth/resend-verification", { email });
    setSent(true);
  });

  return (
    <div
      role="status"
      className="no-print mb-6 flex flex-col gap-3 rounded-xl border border-warning-200 bg-warning-50 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <MailWarning className="mt-0.5 size-5 shrink-0 text-warning-600" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-ink-900">Confirm your email address</p>
          <p className="mt-0.5 text-sm text-ink-600">
            {sent ? (
              <>
                We&rsquo;ve sent a new link to <span className="font-semibold">{email}</span>. It
                expires in 24 hours.
              </>
            ) : (
              <>
                You can browse and compare tutors now, but booking a lesson, paying, messaging and
                leaving a review all need a confirmed address.
              </>
            )}
          </p>
          {error && (
            <p className="mt-1 text-sm font-medium text-danger-600">
              We couldn&rsquo;t send that link. Please try again in a moment.
            </p>
          )}
        </div>
      </div>

      {!sent && (
        <Button size="sm" variant="secondary" onClick={submit} loading={pending} className="shrink-0">
          Resend the link
        </Button>
      )}
    </div>
  );
}
