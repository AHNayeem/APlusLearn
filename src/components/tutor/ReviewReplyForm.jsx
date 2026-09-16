"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Reply, Flag } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Button, Field, Modal, Textarea, FormErrorSummary, useToast } from "@/components/ui";

/** Reply publicly to a review, or report one for moderation (§23). */
export function ReviewReplyForm({ review }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!review.tutorReply && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReplyOpen(true)}
            iconLeft={<Reply className="size-3.5" />}
          >
            Reply publicly
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReportOpen(true)}
          iconLeft={<Flag className="size-3.5" />}
        >
          Report
        </Button>
      </div>

      <ReplyModal open={replyOpen} onClose={() => setReplyOpen(false)} review={review} />
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} review={review} />
    </>
  );
}

function ReplyModal({ open, onClose, review }) {
  const router = useRouter();
  const toast = useToast();
  const [reply, setReply] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/reviews/${review.id}/reply`, { reply });
    toast.success("Reply published", "It appears under the review on your profile.");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reply to this review"
      description="Your reply appears publicly under the review. You can only reply once."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={reply.trim().length < 10}>
            Publish reply
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <blockquote className="rounded-xl bg-ink-50 p-3 text-sm leading-relaxed text-ink-600">
          {review.body}
        </blockquote>

        <Field label="Your reply" htmlFor="reply-body" error={fieldErrors.reply} required>
          <Textarea
            id="reply-body"
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            maxLength={1200}
            error={fieldErrors.reply}
            placeholder="Thanks for the kind words — glad the diagnostic approach worked."
          />
        </Field>

        <p className="text-xs text-ink-500">
          A measured reply to a critical review does more for your profile than a defensive one.
        </p>
      </div>
    </Modal>
  );
}

function ReportModal({ open, onClose, review }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/reviews/${review.id}/report`, { reason });
    toast.success(
      "Review reported",
      "A moderator will look into it. The review stays on your profile until they decide.",
    );
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report this review"
      description="Use this if a review is abusive, false, or breaks our guidelines. A moderator decides the outcome — the review stays on your profile and in your rating until then."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={reason.length < 10}>
            Report review
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />
        <Field label="What's wrong with it?" htmlFor="report-review-reason" error={fieldErrors.reason} required>
          <Textarea
            id="report-review-reason"
            rows={4}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={fieldErrors.reason}
            placeholder="This review describes a lesson that never took place…"
          />
        </Field>
        <p className="text-xs text-ink-500">
          Reported reviews are hidden from your public average until our team has reviewed them.
        </p>
      </div>
    </Modal>
  );
}
