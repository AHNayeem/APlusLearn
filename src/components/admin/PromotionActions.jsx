"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Pause, CalendarPlus, Ban } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Input, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { PROMOTION_STATUS } from "@/constants";
import { formatDate } from "@/lib/utils/format";

/**
 * Lifecycle controls for one promotion (§41 Phase 2).
 *
 * Which buttons appear is a courtesy; the server decides what is legal. An
 * administrator who reaches a finished promotion from a stale page gets a
 * refusal from the API, not a silent reopen — which is why nothing here tries
 * to guess at a transition the service has not been asked to allow.
 */
export function PromotionActions({ promotion }) {
  const router = useRouter();
  const toast = useToast();
  const [extending, setExtending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [endsAt, setEndsAt] = useState(toLocalInput(promotion.endsAt));
  const [reason, setReason] = useState("");

  const patch = (body, message, onDone) =>
    api.patch(`/api/admin/promotions/${promotion.id}`, body).then(() => {
      toast.success(message);
      onDone?.();
      router.refresh();
    });

  const activate = useSubmit(() => patch({ action: "ACTIVATE" }, "Promotion running"));
  const pause = useSubmit(() => patch({ action: "PAUSE" }, "Promotion paused"));
  const extend = useSubmit(() =>
    patch(
      { action: "EXTEND", endsAt: new Date(endsAt).toISOString() },
      "Promotion extended",
      () => setExtending(false),
    ),
  );
  const cancel = useSubmit(() =>
    patch({ action: "CANCEL", reason: reason || undefined }, "Promotion ended", () =>
      setCancelling(false),
    ),
  );

  const finished =
    promotion.status === PROMOTION_STATUS.EXPIRED ||
    promotion.status === PROMOTION_STATUS.CANCELLED;

  if (finished) {
    return (
      <span className="text-[11px] text-ink-400">
        Ended {promotion.endedAt ? formatDate(promotion.endedAt) : ""}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {promotion.status === PROMOTION_STATUS.ACTIVE ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={pause.submit}
          loading={pause.pending}
          iconLeft={<Pause className="size-3.5" />}
        >
          Pause
        </Button>
      ) : (
        <Button
          size="xs"
          variant="ghost"
          onClick={activate.submit}
          loading={activate.pending}
          iconLeft={<Play className="size-3.5" />}
        >
          Activate
        </Button>
      )}

      <Button
        size="xs"
        variant="ghost"
        onClick={() => setExtending(true)}
        iconLeft={<CalendarPlus className="size-3.5" />}
      >
        Extend
      </Button>

      <Button
        size="xs"
        variant="dangerGhost"
        onClick={() => setCancelling(true)}
        iconLeft={<Ban className="size-3.5" />}
      >
        End
      </Button>

      <Modal
        open={extending}
        onClose={() => setExtending(false)}
        title="Extend this promotion"
        description={`It currently ends on ${formatDate(promotion.endsAt)}.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExtending(false)}>
              Cancel
            </Button>
            <Button onClick={extend.submit} loading={extend.pending} disabled={!endsAt}>
              Extend
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={extend.error} fieldErrors={extend.fieldErrors} />
          <Field
            label="New end date"
            htmlFor="promotion-ends-at"
            hint="Has to be later than the current end date."
            error={extend.fieldErrors.endsAt}
            required
          >
            <Input
              id="promotion-ends-at"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              error={extend.fieldErrors.endsAt}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="End this promotion"
        description="The tutor drops back to their normal position in search straight away. The record is kept."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={cancel.submit} loading={cancel.pending}>
              End promotion
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={cancel.error} fieldErrors={cancel.fieldErrors} />
          <Field
            label="Reason"
            htmlFor="promotion-cancel-reason"
            hint="Optional. Kept in the audit trail."
            error={cancel.fieldErrors.reason}
          >
            <Textarea
              id="promotion-cancel-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={cancel.fieldErrors.reason}
              placeholder="Campaign finished early."
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

/** `datetime-local` wants a local wall-clock string, not an ISO instant. */
function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
