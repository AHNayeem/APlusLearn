"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Card, CardBody, CardHeader, Field, FormErrorSummary, Select, Textarea, useToast,
} from "@/components/ui";
import { SUPPORT_TICKET_STATUS_LABELS } from "@/constants";

/**
 * Work a support ticket: move its status, write an internal note, or both in
 * one save. The allowed moves are handed down from the server's own
 * transition table, so this form can only offer what the service will accept —
 * and the service checks again regardless.
 */
export function SupportTicketActions({ ticketId, status, allowed = [] }) {
  const router = useRouter();
  const toast = useToast();
  const [nextStatus, setNextStatus] = useState("");
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch(`/api/admin/support/tickets/${ticketId}`, {
      ...(nextStatus ? { status: nextStatus } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    toast.success("Ticket updated");
    setNextStatus("");
    setNote("");
    router.refresh();
  });

  const nothingToSave = !nextStatus && note.trim().length < 3;

  return (
    <Card className="border-brand-200">
      <CardHeader
        title="Update this ticket"
        description={`Currently ${SUPPORT_TICKET_STATUS_LABELS[status].toLowerCase()}. Every change is recorded in the audit log.`}
      />
      <CardBody>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          {allowed.length > 0 && (
            <Field label="Move to" htmlFor="ticket-status" error={fieldErrors.status}>
              <Select id="ticket-status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                <option value="">Keep as {SUPPORT_TICKET_STATUS_LABELS[status].toLowerCase()}</option>
                {allowed.map((value) => (
                  <option key={value} value={value}>
                    {SUPPORT_TICKET_STATUS_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Internal note"
            htmlFor="ticket-note"
            hint="What you did or found. Only administrators see this."
            error={fieldErrors.note}
          >
            <Textarea
              id="ticket-note"
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          <Button type="submit" loading={pending} disabled={nothingToSave}>
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
