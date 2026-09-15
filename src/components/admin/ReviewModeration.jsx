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

/** Keep or remove a reported review (§23). */
export function ReviewModeration({ review }) {
  const [decision, setDecision] = useState(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          size="xs"
          onClick={() => setDecision(REVIEW_STATUS.PUBLISHED)}
          iconLeft={<Check className="size-3.5" />}
        >
          Keep published
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

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/reviews/${review.id}`, {
      status: decision,
      note: note || undefined,
    });
    toast.success(
      isRemove ? "Review removed" : "Review kept",
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
      title={isRemove ? "Remove this review" : "Keep this review published"}
      description={
        isRemove
          ? "It disappears from the tutor's profile and stops counting towards their rating."
          : "It stays on the profile and counts towards the tutor's rating."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={isRemove ? "danger" : "primary"} onClick={submit} loading={pending}>
            {isRemove ? "Remove review" : "Keep published"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <blockquote className="rounded-xl bg-ink-50 p-3 text-sm leading-relaxed text-ink-600">
          {review.body}
        </blockquote>

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
