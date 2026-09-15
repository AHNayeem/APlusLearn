"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Stepper, FormErrorSummary, useToast,
} from "@/components/ui";
import { ONBOARDING_STEPS, ONBOARDING_STEP_META } from "@/constants/onboarding";
import { TUTOR_STATUS } from "@/constants";
import { STEP_COMPONENTS } from "./steps";

/**
 * Tutor onboarding (§17).
 *
 * Each step saves independently, so progress is never lost. Validation runs
 * server-side per step and again on submit, which is what lets the wizard be
 * forgiving without letting bad data through (§37).
 */
export function OnboardingWizard({ application: initial, courses, grades, provinces, subjects }) {
  const router = useRouter();
  const toast = useToast();

  const [application, setApplication] = useState(initial);
  const [current, setCurrent] = useState(initial.currentStep ?? ONBOARDING_STEPS[0]);
  const [stepData, setStepData] = useState(initial.data?.[initial.currentStep] ?? {});

  const index = ONBOARDING_STEPS.indexOf(current);
  const meta = ONBOARDING_STEP_META[current];
  const StepComponent = STEP_COMPONENTS[current];
  const isLast = current === "REVIEW";

  const goTo = useCallback(
    (step) => {
      setCurrent(step);
      setStepData(application.data?.[step] ?? {});
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [application.data],
  );

  const { submit: saveStep, pending: saving, error, fieldErrors, reset } = useSubmit(
    async ({ advance = true } = {}) => {
      const result = await api.post("/api/tutor/onboarding", { step: current, data: stepData });
      setApplication(result.application);

      if (advance && !isLast) {
        goTo(ONBOARDING_STEPS[index + 1]);
        toast.success("Progress saved");
      } else if (!advance) {
        toast.success("Progress saved", "You can come back to this any time.");
      }
      return result;
    },
  );

  const { submit: submitApplication, pending: submitting, error: submitError } = useSubmit(
    async () => {
      // The review step's confirmation is saved before submitting.
      await api.post("/api/tutor/onboarding", { step: "REVIEW", data: stepData });
      const result = await api.post("/api/tutor/onboarding/submit");
      toast.success("Application submitted", "We review applications within two business days.");
      router.push("/tutor/verification?submitted=1");
      router.refresh();
      return result;
    },
  );

  const locked =
    application.status === TUTOR_STATUS.PENDING_REVIEW ||
    application.status === TUTOR_STATUS.APPROVED;

  if (locked) {
    return (
      <Alert
        tone="info"
        title={
          application.status === TUTOR_STATUS.APPROVED
            ? "Your application is approved"
            : "Your application is being reviewed"
        }
        action={
          <Button
            href={
              application.status === TUTOR_STATUS.APPROVED
                ? "/tutor/profile"
                : "/tutor/verification"
            }
            size="sm"
          >
            {application.status === TUTOR_STATUS.APPROVED ? "Edit profile" : "Check status"}
          </Button>
        }
      >
        {application.status === TUTOR_STATUS.APPROVED
          ? "Edit your live profile from the profile page instead."
          : "You'll be emailed as soon as there's a decision."}
      </Alert>
    );
  }

  return (
    <div className="max-w-3xl">
      <Stepper
        steps={ONBOARDING_STEPS.map((step) => ({
          value: step,
          label: ONBOARDING_STEP_META[step].title,
        }))}
        current={current}
        onStepClick={(step) => {
          // Only steps already reached can be revisited.
          if (application.completedSteps.includes(step) || step === current) goTo(step);
        }}
        className="mb-8"
      />

      <Card>
        <CardHeader title={meta.title} description={meta.description} />
        <CardBody>
          <FormErrorSummary error={error ?? submitError} fieldErrors={fieldErrors} />

          <div className={error || Object.keys(fieldErrors).length ? "mt-5" : ""}>
            <StepComponent
              value={stepData}
              onChange={(next) => {
                setStepData(next);
                reset();
              }}
              fieldErrors={fieldErrors}
              application={application}
              courses={courses}
              grades={grades}
              provinces={provinces}
              subjects={subjects}
            />
          </div>
        </CardBody>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 bg-ink-50/60 p-5">
          <Button
            variant="ghost"
            onClick={() => goTo(ONBOARDING_STEPS[index - 1])}
            disabled={index === 0}
            iconLeft={<ArrowLeft className="size-4" />}
          >
            Back
          </Button>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => saveStep({ advance: false })}
              loading={saving}
              iconLeft={<Save className="size-4" />}
            >
              Save progress
            </Button>

            {isLast ? (
              <Button
                onClick={submitApplication}
                loading={submitting}
                iconRight={<Check className="size-4" />}
              >
                Submit application
              </Button>
            ) : (
              <Button
                onClick={() => saveStep({ advance: true })}
                loading={saving}
                iconRight={<ArrowRight className="size-4" />}
              >
                Save and continue
              </Button>
            )}
          </div>
        </div>
      </Card>

      <p className="mt-4 text-center text-xs text-ink-500">
        Your progress is saved on every step — you can close this and come back.
      </p>
    </div>
  );
}
