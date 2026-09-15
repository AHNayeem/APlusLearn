"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Field, Input, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/** Issue a manual refund. The service caps it at the remaining balance (§20). */
export function RefundButton({ payment }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const refundable = payment.totalCents - (payment.refundedCents ?? 0);
  const [amount, setAmount] = useState(refundable / 100);
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/payments/${payment.id}/refund`, {
      amountCents: Math.round(Number(amount) * 100),
      reason,
    });
    toast.success("Refund issued", "The family has been notified.");
    setOpen(false);
    setReason("");
    router.refresh();
  });

  if (refundable <= 0) return null;

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        iconLeft={<Undo2 className="size-3.5" />}
      >
        Refund
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Issue a refund"
        description="This sends money back to the family's original payment method."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={submit}
              loading={pending}
              disabled={reason.trim().length < 10 || Number(amount) <= 0}
            >
              Refund {formatMoney(Math.round(Number(amount) * 100))}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Alert tone="neutral">
            Paid {formatMoney(payment.totalCents)}
            {payment.refundedCents > 0 && (
              <> · already refunded {formatMoney(payment.refundedCents)}</>
            )}
            <span className="mt-1 block font-semibold">
              Up to {formatMoney(refundable)} can still be refunded.
            </span>
          </Alert>

          <Field
            label="Refund amount"
            htmlFor="refund-amount"
            error={fieldErrors.amountCents}
            required
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                $
              </span>
              <input
                id="refund-amount"
                type="number"
                step="0.01"
                min={0.01}
                max={refundable / 100}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-11 w-full rounded-xl border-0 bg-white pl-7 pr-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>
          </Field>

          <Field
            label="Reason"
            htmlFor="refund-reason"
            hint="Recorded in the audit log and shown to the family."
            error={fieldErrors.reason}
            required
          >
            <Textarea
              id="refund-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fieldErrors.reason}
              placeholder="Tutor cancelled twice at short notice — goodwill refund agreed by support."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
