"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/**
 * Reverse a referral (§41 Phase 2).
 *
 * The claw-back is bounded at each balance: credit already spent on a lesson
 * that went ahead is written off rather than pushing an account into debt.
 * The dialog says so, because an administrator should know what will and will
 * not come back before they press it.
 */
export function ReverseReferralButton({ referral }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const { referral: reversed } = await api.patch(`/api/admin/referrals/${referral.id}`, {
      reason,
    });
    const recovered =
      (reversed.recovered?.referrer?.recoveredCents ?? 0) +
      (reversed.recovered?.referee?.recoveredCents ?? 0);
    const writtenOff =
      (reversed.recovered?.referrer?.writtenOffCents ?? 0) +
      (reversed.recovered?.referee?.writtenOffCents ?? 0);

    toast.success(
      "Referral reversed",
      writtenOff > 0
        ? `${formatMoney(recovered)} recovered, ${formatMoney(writtenOff)} already spent and written off.`
        : `${formatMoney(recovered)} recovered.`,
    );
    setOpen(false);
    router.refresh();
  });

  const total = (referral.referrerRewardCents ?? 0) + (referral.refereeRewardCents ?? 0);

  return (
    <>
      <Button
        size="xs"
        variant="dangerGhost"
        onClick={() => setOpen(true)}
        iconLeft={<Undo2 className="size-3.5" />}
      >
        Reverse
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Reverse this referral"
        description={
          total > 0
            ? `Up to ${formatMoney(total)} of credit will be taken back.`
            : "No credit was granted, so this only records the decision."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={submit}
              loading={pending}
              disabled={reason.trim().length < 5}
            >
              Reverse
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />
          <p className="text-sm text-ink-600">
            Credit that has already been spent on a lesson that went ahead cannot be recovered. It
            is written off and recorded rather than leaving an account in debt.
          </p>
          <Field
            label="Reason"
            htmlFor="reverse-reason"
            hint="Kept in the audit trail."
            error={fieldErrors.reason}
            required
          >
            <Textarea
              id="reverse-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fieldErrors.reason}
              placeholder="Both accounts share a confirmed mobile number."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
