import Link from "next/link";
import { Alert, Button, Progress } from "@/components/ui";
import { TUTOR_STATUS } from "@/constants";

/**
 * Shown across the tutor workspace until a profile is live, so the next
 * action is always obvious (§17).
 */
export function ApplicationStatusBanner({ application, profile }) {
  const status = profile?.status ?? application?.status ?? TUTOR_STATUS.DRAFT;

  if (status === TUTOR_STATUS.APPROVED && profile?.isSearchable) return null;

  if (status === TUTOR_STATUS.PENDING_REVIEW) {
    return (
      <Alert tone="info" title="Your application is with our team" className="mb-6">
        We review applications and verification documents within two business days. We&rsquo;ll email
        you as soon as there&rsquo;s a decision.
      </Alert>
    );
  }

  if (status === TUTOR_STATUS.INFO_REQUESTED) {
    return (
      <Alert
        tone="warning"
        title="We need a bit more information"
        className="mb-6"
        action={
          <Button href="/tutor/onboarding" size="sm">
            Update application
          </Button>
        }
      >
        {profile?.infoRequestedMessage ??
          application?.reviewNotes?.at(-1)?.message ??
          "Open your application to see what's needed."}
      </Alert>
    );
  }

  if (status === TUTOR_STATUS.REJECTED) {
    return (
      <Alert tone="danger" title="Your application wasn't approved" className="mb-6">
        {profile?.rejectionReason ?? "Contact support if you'd like to discuss this."}
      </Alert>
    );
  }

  if (status === TUTOR_STATUS.SUSPENDED) {
    return (
      <Alert tone="danger" title="Your profile is suspended" className="mb-6">
        Your profile has been removed from search. Contact support to discuss reinstating it.
      </Alert>
    );
  }

  if (status === TUTOR_STATUS.APPROVED && !profile?.isSearchable) {
    return (
      <Alert
        tone="warning"
        title="Your profile isn't visible yet"
        className="mb-6"
        action={
          <Button href="/tutor/profile" size="sm">
            Complete profile
          </Button>
        }
      >
        You&rsquo;re approved, but some required information is missing so your profile is still
        hidden from search.
      </Alert>
    );
  }

  // Draft — show progress towards submitting.
  const progress = application?.progressPercent ?? 0;
  return (
    <Alert
      tone="info"
      title="Finish your application to start getting bookings"
      className="mb-6"
      action={
        <Button href="/tutor/onboarding" size="sm">
          {progress > 0 ? "Continue" : "Get started"}
        </Button>
      }
    >
      <p>Your profile stays hidden until our team has reviewed it.</p>
      <Progress value={progress} label="Application progress" showValue className="mt-3 max-w-sm" />
    </Alert>
  );
}
