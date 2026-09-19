"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * A tutor stepping back from a request (§41 Phase 2).
 *
 * Declining an invitation and withdrawing a pitch are the same action to the
 * tutor and two different facts to the family, so which one it is comes from
 * whether they had already replied — not from a choice in the dialog.
 */
export function RequestWithdrawButton({ requestId, hasResponded }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.delete(`/api/requests/${requestId}/interest`, {
      body: { action: hasResponded ? "WITHDRAW" : "DECLINE", reason: reason || undefined },
    });
    toast.success(
      hasResponded ? "Response withdrawn" : "Invitation declined",
      "The family has been told.",
    );
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        iconLeft={<XCircle className="size-3.5" />}
      >
        {hasResponded ? "Withdraw my reply" : "Decline"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={hasResponded ? "Withdraw your reply" : "Decline this request"}
        description={
          hasResponded
            ? "The family will see that you are no longer available."
            : "You won't be shown this request again."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Never mind
            </Button>
            <Button variant="danger" onClick={submit} loading={pending}>
              {hasResponded ? "Withdraw" : "Decline"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />
          <Field label="Reason" htmlFor="withdraw-reason" hint="Optional — shared with the family.">
            <Textarea
              id="withdraw-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="My evenings are full this term."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
