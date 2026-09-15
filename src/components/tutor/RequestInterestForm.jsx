"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/** Express interest in a tutor request (§22). */
export function RequestInterestForm({ request, alreadyResponded, hourlyRateCents }) {
  const router = useRouter();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [proposedRate, setProposedRate] = useState(
    hourlyRateCents ? hourlyRateCents / 100 : "",
  );

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/requests/${request.id}/interest`, {
      message,
      proposedRateCents: proposedRate ? Math.round(Number(proposedRate) * 100) : undefined,
    });
    toast.success("Interest sent", "The family can now see your response.");
    router.refresh();
  });

  if (alreadyResponded) {
    return (
      <Alert tone="success" title="You've responded to this request">
        The family can see your message and rate. They&rsquo;ll be in touch if it&rsquo;s a fit.
      </Alert>
    );
  }

  const overBudget =
    proposedRate && Math.round(Number(proposedRate) * 100) > request.budgetMaxCents;

  return (
    <Card>
      <CardHeader
        title="Express interest"
        description="Say why you're a fit. Specific beats enthusiastic — mention the unit, the approach, the timing."
      />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Field
            label="Your message"
            htmlFor="interest-message"
            hint="At least 30 characters. This is the only thing the family reads before deciding."
            error={fieldErrors.message}
            required
          >
            <Textarea
              id="interest-message"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={1200}
              error={fieldErrors.message}
              placeholder="I tutor this course regularly and biochemistry is the unit students most often need help with. I'd suggest two 90-minute sessions a week until the unit test, then dropping back to one. I'm free Tuesday and Thursday evenings, which matches what you've asked for."
            />
          </Field>

          <Field
            label="Your rate for this student"
            htmlFor="interest-rate"
            hint={`Their budget is up to ${formatMoney(request.budgetMaxCents, { compact: true })}/hour.`}
            error={fieldErrors.proposedRateCents}
          >
            <div className="relative max-w-40">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                $
              </span>
              <input
                id="interest-rate"
                type="number"
                inputMode="numeric"
                min={15}
                value={proposedRate}
                onChange={(e) => setProposedRate(e.target.value)}
                className="h-11 w-full rounded-xl border-0 bg-white pl-7 pr-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>
            {overBudget && (
              <p className="mt-2 text-xs text-warning-700">
                That&rsquo;s above their stated budget — worth explaining why in your message.
              </p>
            )}
          </Field>

          <Button
            type="submit"
            loading={pending}
            disabled={message.trim().length < 30}
            iconLeft={<Send className="size-4" />}
          >
            Send my interest
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
