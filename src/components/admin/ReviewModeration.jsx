"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { REVIEW_STATUS } from "@/constants";

/**
 * Keep or remove a reported review, or approve or remove one awaiting
 * approval (§23, R21.5). Both rulings go through the same endpoint; only the
 * wording changes, because "keep published" means nothing for a review that
 * was never published.
 */
export function ReviewModeration({ review }) {
  const [decision, setDecision] = useState(null);
  const pendingApproval = review.status === REVIEW_STATUS.PENDING_MODERATION;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          onClick={() => setDecision(REVIEW_STATUS.PUBLISHED)}
          iconLeft={<Check className="size-3.5" />}
        >
          {pendingApproval ? "Approve" : "Keep published"}
        </Button>
        <Button
          variant="dangerGhost"
          size="xs"
          onClick={() => setDecision(REVIEW_STATUS.REMOVED)}
          iconLeft={<Trash2 className="size-3.5" />}
        >
          Remove
        </Button>
      </div>

      <ModerationModal
        decision={decision}
        onClose={() => setDecision(null)}
        review={review}
      />
    </>
  );
}

function ModerationModal({ decision, onClose, review }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");

  const isRemove = decision === REVIEW_STATUS.REMOVED;
  const pendingApproval = review.status === REVIEW_STATUS.PENDING_MODERATION;
  const keepLabel = pendingApproval ? "Approve review" : "Keep published";

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/reviews/${review.id}`, {
      status: decision,
      note: note || undefined,
    });
    toast.success(
      isRemove ? "Review removed" : pendingApproval ? "Review approved" : "Review kept",
      "The tutor's rating has been recalculated.",
    );
    onClose();
    setNote("");
    router.refresh();
  });

  if (!decision) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isRemove
          ? "Remove this review"
          : pendingApproval
            ? "Approve this review"
            : "Keep this review published"
      }
      description={
        isRemove
          ? pendingApproval
            ? "It is never published and never counts towards the tutor's rating."
            : "It disappears from the tutor's profile and stops counting towards their rating."
          : pendingApproval
            ? "It is published on the tutor's profile and starts counting towards their rating."
            : "It stays on the profile and counts towards the tutor's rating."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={isRemove ? "danger" : "primary"} onClick={submit} loading={pending}>
            {isRemove ? "Remove review" : keepLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        {review.body ? (
          <blockquote className="rounded-xl bg-ink-50 p-3 text-sm leading-relaxed text-ink-600">
            {review.body}
          </blockquote>
        ) : (
          <p className="text-sm italic text-ink-500">A {review.rating}-star rating with no written review.</p>
        )}

        {review.reportReason && (
          <div className="rounded-xl border border-warning-100 bg-warning-50 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-warning-700">
              Reported because
            </p>
            <p className="mt-1 text-sm text-ink-700">{review.reportReason}</p>
          </div>
        )}

        <Field label="Moderation note" htmlFor="moderate-note" hint="Recorded in the audit log.">
          <Textarea
            id="moderate-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={600}
            placeholder={
              isRemove
                ? "Review describes a lesson that the booking record shows was cancelled, not taught."
                : "Review is critical but factual and describes a real lesson. Keeping it."
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
