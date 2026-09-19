"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/**
 * Cancel a package and get the unused lessons refunded (§41 Phase 2).
 *
 * The dialog states the amount before it is confirmed, because only the
 * *unused* lessons come back — the delivered ones were taught, and the tutor
 * has already earned them.
 */
export function CancelPackageButton({ purchase, remaining }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const refundCents = purchase.perSessionCents * remaining;

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.delete(`/api/packages/${purchase.id}`, {
      body: { reason: reason || undefined },
    });
    toast.success(
      "Package cancelled",
      result.refundCents > 0
        ? `${formatMoney(result.refundCents)} is on its way back to you.`
        : "Nothing was left to refund.",
    );
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setOpen(true)}
        iconLeft={<XCircle className="size-4" />}
      >
        Cancel package
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel this package?"
        description={`${remaining} unused lesson${remaining === 1 ? "" : "s"} — about ${formatMoney(refundCents)} — will be refunded.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={submit} loading={pending}>
              Cancel and refund
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />
          <p className="text-sm text-ink-600">
            Lessons you have already booked from this package stay booked. Cancel those separately
            if you no longer want them — the usual cancellation policy applies.
          </p>
          <Field label="Why?" htmlFor="cancel-package-reason" hint="Optional.">
            <Textarea
              id="cancel-package-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
