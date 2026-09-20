"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, ShieldCheck, ShieldX } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Field, Modal, Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { RISK_CASE_STATUS, RISK_ACTIONS, RISK_ACTION_LABELS } from "@/constants";

/**
 * Review controls for one risk case (§41 Phase 2).
 *
 * Resolving a case records a decision; it does not carry one out. Suspending
 * an account is still done from user management, deliberately and with its
 * own audit entry — the dialog says so, because an administrator choosing
 * "Account suspended" here should not believe they have just suspended
 * somebody.
 */
export function RiskCaseActions({ riskCase }) {
  const router = useRouter();
  const toast = useToast();
  const [resolving, setResolving] = useState(null);
  const [outcome, setOutcome] = useState(RISK_ACTIONS.NONE);
  const [note, setNote] = useState("");

  const patch = (body, message, onDone) =>
    api.patch(`/api/admin/risk/${riskCase.id}`, body).then(() => {
      toast.success(message);
      onDone?.();
      router.refresh();
    });

  const take = useSubmit(() => patch({ action: "REVIEW" }, "Case taken for review"));
  const resolve = useSubmit(() =>
    patch(
      {
        action: "RESOLVE",
        resolution: resolving,
        outcome,
        note: note || undefined,
      },
      resolving === RISK_CASE_STATUS.CONFIRMED ? "Case confirmed" : "Case cleared",
      () => {
        setResolving(null);
        setNote("");
        setOutcome(RISK_ACTIONS.NONE);
      },
    ),
  );

  const resolved =
    riskCase.status === RISK_CASE_STATUS.CONFIRMED ||
    riskCase.status === RISK_CASE_STATUS.CLEARED;

  if (resolved) {
    return (
      <span className="text-[11px] text-ink-400">
        {riskCase.resolvedBy
          ? `by ${riskCase.resolvedBy.firstName} ${riskCase.resolvedBy.lastName}`
          : "Resolved"}
      </span>
    );
  }

  const confirming = resolving === RISK_CASE_STATUS.CONFIRMED;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {riskCase.status === RISK_CASE_STATUS.OPEN && (
        <Button
          size="xs"
          variant="ghost"
          onClick={take.submit}
          loading={take.pending}
          iconLeft={<Eye className="size-3.5" />}
        >
          Take
        </Button>
      )}

      <Button
        size="xs"
        variant="ghost"
        onClick={() => setResolving(RISK_CASE_STATUS.CLEARED)}
        iconLeft={<ShieldCheck className="size-3.5" />}
      >
        Clear
      </Button>

      <Button
        size="xs"
        variant="dangerGhost"
        onClick={() => setResolving(RISK_CASE_STATUS.CONFIRMED)}
        iconLeft={<ShieldX className="size-3.5" />}
      >
        Confirm
      </Button>

      <Modal
        open={!!resolving}
        onClose={() => setResolving(null)}
        title={confirming ? "Confirm this case" : "Clear this case"}
        description={
          confirming
            ? "Record what was found and what was done about it. The signals are kept either way."
            : "Record that this account was looked at and found fine. That record is worth as much as a confirmation."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolving(null)}>
              Cancel
            </Button>
            <Button
              variant={confirming ? "danger" : "primary"}
              onClick={resolve.submit}
              loading={resolve.pending}
              disabled={confirming && note.trim().length < 10}
            >
              {confirming ? "Confirm" : "Clear"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={resolve.error} fieldErrors={resolve.fieldErrors} />

          {confirming && (
            <Alert tone="warning" title="This does not restrict the account">
              Choosing &ldquo;Account suspended&rdquo; records that a suspension was applied. Apply
              it from the account&rsquo;s page in Users — that is the only place an account is
              actually restricted, and it keeps its own audit entry.
            </Alert>
          )}

          <Field
            label="What was done"
            htmlFor="risk-outcome"
            hint="Kept on the case and in the audit trail."
            error={resolve.fieldErrors.outcome}
          >
            <Select
              id="risk-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              error={resolve.fieldErrors.outcome}
            >
              {Object.values(RISK_ACTIONS).map((value) => (
                <option key={value} value={value}>
                  {RISK_ACTION_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Notes"
            htmlFor="risk-note"
            hint={confirming ? "Required — at least a sentence." : "Optional."}
            error={resolve.fieldErrors.note}
            required={confirming}
          >
            <Textarea
              id="risk-note"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={resolve.fieldErrors.note}
              placeholder={
                confirming
                  ? "Three accounts sharing one confirmed mobile number, all claiming referral credit."
                  : "Cancellations were all inside the free window after a family illness."
              }
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
