"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * Close a request's report case without acting on the request (R28.24).
 *
 * The other ruling — upholding the report — is the ordinary Remove action,
 * which resolves the case as it takes the request down. Both are recorded in
 * the request's moderation history and the audit log.
 */
export function DismissReportButton({ request }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch(`/api/admin/requests/${request.id}`, { action: "DISMISS_REPORT", note });
    toast.success("Report dismissed", `Ref ${request.reference}`);
    setOpen(false);
    setNote("");
    router.refresh();
  });

  return (
    <>
      <Button
        size="xs"
        variant="secondary"
        onClick={() => setOpen(true)}
        iconLeft={<Check className="size-3.5" />}
      >
        Dismiss report
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Dismiss this report"
        description="The request stays exactly as it is. The family is not told; the members who reported it may report it again if something changes."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={pending} disabled={note.trim().length < 5}>
              Dismiss report
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />
          <Field
            label="Reason"
            htmlFor="dismiss-report-note"
            hint="Kept in the moderation history and the audit trail."
            error={fieldErrors.note}
            required
          >
            <Textarea
              id="dismiss-report-note"
              rows={3}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={fieldErrors.note}
              placeholder="The notes describe the course, not a contact detail. Nothing to act on."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
