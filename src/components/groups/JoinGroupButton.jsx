"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Clock } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Field, Modal, Select, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/**
 * Taking a seat in a group session (§41 Phase 2).
 *
 * A full session offers the waiting list instead, which costs nothing and
 * charges nothing — a seat that frees up is offered, not auto-purchased.
 */
export function JoinGroupButton({ session, students, signedIn, alreadyJoined }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [studentProfileId, setStudentProfileId] = useState(students?.[0]?.id ?? "");

  const full = session.seatsRemaining <= 0;

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post(`/api/groups/${session.id}/join`, { studentProfileId });

    if (result.waitlisted) {
      toast.success(
        "You're on the waiting list",
        `Position ${result.waitlistPosition}. We'll tell you if a seat opens up — nothing has been charged.`,
      );
      setOpen(false);
      router.refresh();
      return result;
    }

    toast.success("Seat held", "Complete payment to confirm it.");
    router.push(`/bookings/checkout/${result.payment.id}`);
    return result;
  });

  if (alreadyJoined) {
    return (
      <Button variant="secondary" href="/groups" fullWidth>
        You&rsquo;re in this session
      </Button>
    );
  }

  return (
    <>
      <Button
        fullWidth
        size="lg"
        variant={full ? "secondary" : "primary"}
        onClick={() => setOpen(true)}
        iconLeft={full ? <Clock className="size-4" /> : <UserPlus className="size-4" />}
      >
        {full
          ? "Join the waiting list"
          : signedIn
            ? `Take a seat — ${formatMoney(session.pricePerSeatCents)}`
            : "Sign in to join"}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={full ? "Join the waiting list" : "Take a seat"}
        description={
          full
            ? "Nothing is charged for a place in the queue."
            : `${formatMoney(session.pricePerSeatCents)} for a seat. You pay at the next step.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {signedIn ? (
              <Button onClick={submit} loading={pending} disabled={!studentProfileId}>
                {full ? "Join the list" : "Continue to payment"}
              </Button>
            ) : (
              <Button href={`/login?next=/groups/${session.id}`}>Sign in</Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          {!signedIn ? (
            <Alert tone="info" title="Sign in to join">
              A seat is tied to a learner on your account.
            </Alert>
          ) : students?.length === 0 ? (
            <Alert tone="warning" title="Add a child first">
              We need to know who is attending.
            </Alert>
          ) : (
            <Field label="Who is attending?" htmlFor="group-student" required>
              <Select
                id="group-student"
                value={studentProfileId}
                onChange={(e) => setStudentProfileId(e.target.value)}
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName}
                    {student.gradeName ? ` · ${student.gradeName}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {!full && session.seatsTaken < session.minParticipants && (
            <Alert tone="neutral" title="This session still needs people">
              It needs {session.minParticipants} to go ahead and has {session.seatsTaken}. If it
              doesn&rsquo;t fill up in time, it is cancelled and you are refunded in full.
            </Alert>
          )}
        </div>
      </Modal>
    </>
  );
}
