"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Button, Field, Modal, Textarea, FormErrorSummary, useToast } from "@/components/ui";

/**
 * Report a published review, for any signed-in member (R21.5).
 *
 * The reviewed tutor has their own version beside the reply form; this one is
 * for everybody else reading a profile. Reporting opens a case and the review
 * stays up until a moderator rules, which the dialog says plainly.
 */
export function ReportReviewButton({ reviewId }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/reviews/${reviewId}/report`, { reason });
    toast.success("Review reported", "Our moderation team will take a look.");
    setOpen(false);
    setReason("");
    setDone(true);
  });

  if (done) {
    return <span className="text-xs text-ink-400">Reported</span>;
  }

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        iconLeft={<Flag className="size-3" />}
      >
        Report
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report this review"
        description="Use this if a review is abusive, false or breaks our guidelines. A moderator decides the outcome; the review stays visible until then."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={submit}
              loading={pending}
              disabled={reason.trim().length < 10}
            >
              Report review
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />
          <Field
            label="What's wrong with it?"
            htmlFor={`report-review-${reviewId}`}
            error={fieldErrors.reason}
            required
          >
            <Textarea
              id={`report-review-${reviewId}`}
              rows={4}
              maxLength={600}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fieldErrors.reason}
              placeholder="This review contains a personal attack rather than a description of the lesson…"
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
