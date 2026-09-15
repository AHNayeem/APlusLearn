"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Send } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { PAYOUT_STATUS, PAYOUT_STATUS_LABELS } from "@/constants";
import { formatMoney } from "@/lib/utils/format";

/** Create a payout for a tutor with settled, held-past-hold earnings (§20). */
export function CreatePayoutButton({ tutor }) {
  const router = useRouter();
  const toast = useToast();

  const { submit, pending } = useSubmit(
    async () => {
      const result = await api.post("/api/admin/payouts", { tutorUserId: tutor.tutorUserId });
      toast.success(
        `Payout created for ${formatMoney(result.payout.amountCents)}`,
        "Mark it paid once the transfer clears.",
      );
      router.refresh();
      return result;
    },
    { onError: (error) => toast.error("Couldn't create payout", error.message) },
  );

  return (
    <Button
      size="xs"
      onClick={submit}
      loading={pending}
      disabled={!tutor.payoutsEnabled}
      title={tutor.payoutsEnabled ? undefined : "Tutor hasn't finished payout setup"}
      iconLeft={<Banknote className="size-3.5" />}
    >
      Create payout
    </Button>
  );
}

/** Move a payout through scheduled → in transit → paid (or failed). */
export function UpdatePayoutButton({ payout }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(PAYOUT_STATUS.PAID);
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch(`/api/admin/payouts/${payout.id}`, { status, note: note || undefined });
    toast.success("Payout updated", "The tutor has been notified.");
    setOpen(false);
    setNote("");
    router.refresh();
  });

  if (payout.status === PAYOUT_STATUS.PAID) return null;

  return (
    <>
      <Button
        variant="secondary"
        size="xs"
        onClick={() => setOpen(true)}
        iconLeft={<Send className="size-3.5" />}
      >
        Update
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Update payout ${payout.reference}`}
        description={`${formatMoney(payout.amountCents)} across ${payout.lessonCount} lessons.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Field label="New status" htmlFor="payout-status">
            <Select id="payout-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {[
                PAYOUT_STATUS.SCHEDULED,
                PAYOUT_STATUS.IN_TRANSIT,
                PAYOUT_STATUS.PAID,
                PAYOUT_STATUS.FAILED,
              ].map((value) => (
                <option key={value} value={value}>
                  {PAYOUT_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Note"
            htmlFor="payout-note"
            hint={
              status === PAYOUT_STATUS.FAILED
                ? "Explain the failure — the lessons are released so the payout can be retried."
                : "Optional, included in the tutor's notification."
            }
          >
            <Textarea
              id="payout-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={600}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
