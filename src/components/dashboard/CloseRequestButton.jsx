"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Button, Field, Modal, Select, useToast } from "@/components/ui";

/** Close a request once a tutor is chosen, or when it's no longer needed (§22). */
export function CloseRequestButton({ requestId, matches = [] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("NO_LONGER_NEEDED");
  const [tutorProfileId, setTutorProfileId] = useState("");

  const { submit, pending } = useSubmit(async () => {
    await api.post(`/api/requests/${requestId}/close`, {
      reason,
      bookedTutorProfileId: reason === "BOOKED" && tutorProfileId ? tutorProfileId : undefined,
    });
    toast.success("Request closed", "Tutors will no longer be able to respond.");
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} iconLeft={<CheckCircle2 className="size-4" />}>
        Close request
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Close this request"
        description="Tutors will no longer be able to respond."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Keep it open
            </Button>
            <Button onClick={submit} loading={pending}>
              Close request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
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
    </>
  );
}
