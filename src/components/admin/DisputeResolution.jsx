"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gavel, StickyNote } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Modal, Select, Textarea,
  FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney, formatRelative } from "@/lib/utils/format";
import { DISPUTE_STATUS } from "@/constants";

/** Adjudicate a dispute and issue any refund it warrants (§26). */
export function DisputeResolution({ dispute, booking }) {
  const [modal, setModal] = useState(null);
  const resolved = ![DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW].includes(dispute.status);

  return (
    <>
      <Card className={resolved ? undefined : "border-brand-300"}>
        <CardHeader
          title={resolved ? "Resolution" : "Resolve this dispute"}
          description={
            resolved
              ? `Resolved ${formatRelative(dispute.resolvedAt)}`
              : "Your decision issues any refund and notifies both parties."
          }
        />
        <CardBody>
          {resolved ? (
            <div className="space-y-3">
              <Alert tone="neutral" title={dispute.status.replace(/_/g, " ").toLowerCase()}>
                {dispute.resolutionNote}
              </Alert>
              {dispute.refundIssuedCents > 0 && (
                <p className="text-sm text-ink-600">
                  Refunded{" "}
                  <span className="font-bold text-success-700">
                    {formatMoney(dispute.refundIssuedCents)}
                  </span>{" "}
                  to the family.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setModal("resolve")} iconLeft={<Gavel className="size-4" />}>
                Resolve dispute
              </Button>
              <Button
                variant="secondary"
                onClick={() => setModal("note")}
                iconLeft={<StickyNote className="size-4" />}
              >
                Add internal note
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <ResolveModal
        open={modal === "resolve"}
        onClose={() => setModal(null)}
        dispute={dispute}
        booking={booking}
      />
      <NoteModal open={modal === "note"} onClose={() => setModal(null)} dispute={dispute} />
    </>
  );
}

function ResolveModal({ open, onClose, dispute, booking }) {
  const router = useRouter();
  const toast = useToast();

  const alreadyRefunded = booking?.cancellation?.refundCents ?? 0;
  const refundable = (booking?.price?.totalCents ?? 0) - alreadyRefunded;

  const [resolution, setResolution] = useState("RESOLVED_NO_REFUND");
  const [refundCents, setRefundCents] = useState(refundable / 100);
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/disputes/${dispute.id}`, {
      resolution,
      refundCents:
        resolution === "RESOLVED_PARTIAL_REFUND"
          ? Math.round(Number(refundCents) * 100)
          : undefined,
      note,
    });
    toast.success("Dispute resolved", "Both parties have been notified.");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resolve this dispute"
      description="Both parties are notified of your decision and any refund is issued immediately."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={note.trim().length < 10}>
            Resolve dispute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Alert tone="neutral">
          Lesson total {formatMoney(booking?.price?.totalCents ?? 0)}
          {alreadyRefunded > 0 && <> · already refunded {formatMoney(alreadyRefunded)}</>}
          <span className="mt-1 block font-semibold">
            Up to {formatMoney(refundable)} can still be refunded.
          </span>
          {dispute.requestedRefundCents > 0 && (
            <span className="mt-1 block">
              They asked for {formatMoney(dispute.requestedRefundCents)}.
            </span>
          )}
        </Alert>

        <Field label="Decision" htmlFor="dispute-resolution" required>
          <Select
            id="dispute-resolution"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            <option value="RESOLVED_REFUND">Full refund</option>
            <option value="RESOLVED_PARTIAL_REFUND">Partial refund</option>
            <option value="RESOLVED_NO_REFUND">No refund — lesson stands</option>
            <option value="REJECTED">Reject the dispute</option>
          </Select>
        </Field>

        {resolution === "RESOLVED_PARTIAL_REFUND" && (
          <Field
            label="Refund amount"
            htmlFor="dispute-refund"
            error={fieldErrors.refundCents}
            required
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                $
              </span>
              <input
                id="dispute-refund"
                type="number"
                step="0.01"
                min={0.01}
                max={refundable / 100}
                value={refundCents}
                onChange={(e) => setRefundCents(e.target.value)}
                className="h-11 w-full rounded-xl border-0 bg-white pl-7 pr-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
            </div>
          </Field>
        )}

        <Field
          label="Reasoning"
          htmlFor="dispute-note"
          hint="Shared with both parties and recorded in the audit log."
          error={fieldErrors.note}
          required
        >
          <Textarea
            id="dispute-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1500}
            error={fieldErrors.note}
            placeholder="The tutor's meeting link was never issued and the lesson didn't take place. Full refund applied."
          />
        </Field>
      </div>
    </Modal>
  );
}

function NoteModal({ open, onClose, dispute }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch(`/api/admin/disputes/${dispute.id}`, { note });
    toast.success("Note added");
    onClose();
    setNote("");
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an internal note"
      description="Only visible to administrators."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={note.trim().length < 3}>
            Add note
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />
        <Field label="Note" htmlFor="internal-note" error={fieldErrors.note} required>
          <Textarea
            id="internal-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1500}
            error={fieldErrors.note}
            placeholder="Called the tutor — they confirm the link failed to send. Awaiting the family's reply."
          />
        </Field>
      </div>
    </Modal>
  );
}
