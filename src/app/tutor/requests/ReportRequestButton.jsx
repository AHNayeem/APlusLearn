"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { REQUEST_REPORT_REASONS } from "@/constants";

/**
 * Report a tutor request to the moderators (R28.24).
 *
 * Reporting opens a case for a moderator; it does not take the request down,
 * and the dialog says so rather than letting a tutor think a click removed it.
 */
export function ReportRequestButton({ requestId }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/requests/${requestId}/report`, {
      reason,
      note: note.trim() || undefined,
    });
    toast.success("Request reported", "Our moderation team will take a look.");
    setOpen(false);
    setReason("");
    setNote("");
    router.refresh();
  });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        iconLeft={<Flag className="size-3.5" />}
      >
        Report
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report this request"
        description="Use this if a request breaks our guidelines — contact details, inappropriate content, or something that isn't a genuine request. A moderator decides what happens next."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={submit} loading={pending} disabled={!reason}>
              Report request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />
          <Field label="Reason" htmlFor="report-request-reason" error={fieldErrors.reason} required>
            <Select
              id="report-request-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fieldErrors.reason}
            >
              <option value="">Choose a reason</option>
              {Object.entries(REQUEST_REPORT_REASONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Anything else?"
            htmlFor="report-request-note"
            hint="Optional — only our moderators see this."
            error={fieldErrors.note}
          >
            <Textarea
              id="report-request-note"
              rows={3}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={fieldErrors.note}
              placeholder="The notes include a phone number and ask tutors to call."
            />
          </Field>
          <p className="text-xs text-ink-500">
            The request stays visible while our team reviews it. The family is not told who
            reported it.
          </p>
        </div>
      </Modal>
    </>
  );
}
