"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Input, Modal, Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * Promote a tutor (§41 Phase 2).
 *
 * The tutor list this offers is already filtered to profiles that are
 * approved, searchable and not currently promoted — but that filter is a
 * convenience, not the control. The service re-checks every one of those
 * rules against the stored records when the request arrives, so a stale list
 * cannot promote somebody who has since been suspended.
 */
export function PromotionCreateForm({ tutors, defaultDurationDays }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [tutorProfileId, setTutorProfileId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post("/api/admin/promotions", {
      tutorProfileId,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      note: note || undefined,
    });
    toast.success("Promotion created", "The tutor has been told their profile is featured.");
    setOpen(false);
    setTutorProfileId("");
    setStartsAt("");
    setEndsAt("");
    setNote("");
    router.refresh();
  });

  return (
    <>
      <Button onClick={() => setOpen(true)} iconLeft={<Megaphone className="size-4" />}>
        Promote a tutor
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Promote a tutor"
        description="The tutor moves up the default search ordering while the promotion runs. Their result is labelled as promoted."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={pending} disabled={!tutorProfileId}>
              Create promotion
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Field
            label="Tutor"
            htmlFor="promotion-tutor"
            hint={
              tutors.length
                ? "Only approved, searchable tutors without a running promotion are listed."
                : "No tutor is currently eligible — a promotion cannot make an unapproved profile visible."
            }
            error={fieldErrors.tutorProfileId}
            required
          >
            <Select
              id="promotion-tutor"
              value={tutorProfileId}
              onChange={(e) => setTutorProfileId(e.target.value)}
              error={fieldErrors.tutorProfileId}
              disabled={!tutors.length}
            >
              <option value="">Choose a tutor…</option>
              {tutors.map((tutor) => (
                <option key={tutor.id} value={tutor.id}>
                  {tutor.name}
                  {tutor.city ? ` — ${tutor.city}` : ""}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Starts"
              htmlFor="promotion-starts"
              hint="Leave blank to start now."
              error={fieldErrors.startsAt}
            >
              <Input
                id="promotion-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                error={fieldErrors.startsAt}
              />
            </Field>

            <Field
              label="Ends"
              htmlFor="promotion-ends"
              hint={`Leave blank for ${defaultDurationDays} days.`}
              error={fieldErrors.endsAt}
            >
              <Input
                id="promotion-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                error={fieldErrors.endsAt}
              />
            </Field>
          </div>

          <Field
            label="Internal note"
            htmlFor="promotion-note"
            hint="Optional. Only administrators see this — never the tutor."
            error={fieldErrors.note}
          >
            <Textarea
              id="promotion-note"
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={fieldErrors.note}
              placeholder="Paid placement, invoice 2026-114."
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
