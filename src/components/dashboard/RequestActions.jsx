"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * What the family can do with an open request (§22, §41 Phase 2).
 *
 * Closing and cancelling are kept apart because they mean different things:
 * closing records an outcome — usually a booking — while cancelling says the
 * need went away. Both are server-side state transitions; neither deletes
 * anything a tutor wrote.
 */
export function RequestActions({ requestId, matches = [] }) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState(null);

  const [reason, setReason] = useState("NO_LONGER_NEEDED");
  const [tutorProfileId, setTutorProfileId] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const close = useSubmit(async () => {
    await api.post(`/api/requests/${requestId}/close`, {
      reason,
      bookedTutorProfileId: reason === "BOOKED" && tutorProfileId ? tutorProfileId : undefined,
    });
    toast.success("Request closed", "Tutors can no longer respond.");
    setDialog(null);
    router.refresh();
  });

  const cancel = useSubmit(async () => {
    await api.delete(`/api/requests/${requestId}`, {
      body: { reason: cancelReason || undefined },
    });
    toast.success("Request cancelled", "Everyone who replied has been told.");
    setDialog(null);
    router.refresh();
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          href={`/requests/${requestId}/edit`}
          iconLeft={<Pencil className="size-4" />}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          onClick={() => setDialog("close")}
          iconLeft={<CheckCircle2 className="size-4" />}
        >
          Close request
        </Button>
        <Button
          variant="ghost"
          onClick={() => setDialog("cancel")}
          iconLeft={<XCircle className="size-4" />}
        >
          Cancel
        </Button>
      </div>

      <Modal
        open={dialog === "close"}
        onClose={() => setDialog(null)}
        title="Close this request"
        description="Tutors will no longer be able to respond."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Keep it open
            </Button>
            <Button onClick={close.submit} loading={close.pending}>
              Close request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={close.error} fieldErrors={close.fieldErrors} />

          <Field label="Why are you closing it?" htmlFor="close-reason">
            <Select id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="BOOKED">I booked a tutor</option>
              <option value="NO_LONGER_NEEDED">We no longer need a tutor</option>
              <option value="OTHER">Something else</option>
            </Select>
          </Field>

          {reason === "BOOKED" && matches.length > 0 && (
            <Field
              label="Which tutor?"
              htmlFor="close-tutor"
              hint="Optional — helps us improve matching."
            >
              <Select
                id="close-tutor"
                value={tutorProfileId}
                onChange={(e) => setTutorProfileId(e.target.value)}
              >
                <option value="">Prefer not to say</option>
                {matches.map((match) => (
                  <option key={match.id} value={match.tutor.id}>
                    {match.tutor.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Modal>

      <Modal
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title="Cancel this request"
        description="We'll let the tutors who replied know it has been withdrawn."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Keep it open
            </Button>
            <Button variant="danger" onClick={cancel.submit} loading={cancel.pending}>
              Cancel request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={cancel.error} fieldErrors={cancel.fieldErrors} />
          <Field label="Why?" htmlFor="cancel-reason" hint="Optional — only our team sees this.">
            <Textarea
              id="cancel-reason"
              rows={3}
              maxLength={300}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="We found a tutor through school instead."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
