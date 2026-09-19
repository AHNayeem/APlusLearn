"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { REQUEST_STATUS } from "@/constants";

/**
 * Remove a tutor request from the board, or put one back (§23, §41 Phase 2).
 *
 * Removal is reversible and always recorded: the note becomes part of the
 * request's moderation history and is shown to the family, so a decision can
 * be explained afterwards rather than only felt.
 */
export function RequestModeration({ request }) {
  const [open, setOpen] = useState(false);
  const removed = request.status === REQUEST_STATUS.REMOVED;

  return (
    <>
      <Button
        size="xs"
        variant={removed ? "secondary" : "dangerGhost"}
        onClick={() => setOpen(true)}
        iconLeft={removed ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
      >
        {removed ? "Restore" : "Remove"}
      </Button>

      {open && (
        <ModerationModal request={request} removed={removed} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ModerationModal({ request, removed, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch(`/api/admin/requests/${request.id}`, {
      action: removed ? "RESTORE" : "REMOVE",
      note,
    });
    toast.success(removed ? "Request restored" : "Request removed", `Ref ${request.reference}`);
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={removed ? "Restore this request" : "Remove this request"}
      description={
        removed
          ? "It returns to the tutor board if it has not expired."
          : "Tutors will no longer see it. The family is told, and the record is kept."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={removed ? "primary" : "danger"}
            onClick={submit}
            loading={pending}
            disabled={note.trim().length < 5}
          >
            {removed ? "Restore" : "Remove"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />
        <Field
          label="Reason"
          htmlFor="moderate-note"
          hint="Shown to the family and kept in the audit trail."
          error={fieldErrors.note}
          required
        >
          <Textarea
            id="moderate-note"
            rows={3}
            maxLength={600}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={fieldErrors.note}
            placeholder={
              removed
                ? "The family edited out the contact details."
                : "Contains personal contact details, which our safety policy does not allow."
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
