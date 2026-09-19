"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Switch, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * Marking who turned up (§41 Phase 2).
 *
 * The consequence is stated before it is applied: an absence becomes a
 * no-show on that learner's own booking, and the platform's existing no-show
 * policy decides the refund — not a separate group rule.
 */
export function AttendanceForm({ sessionId, roster }) {
  const router = useRouter();
  const toast = useToast();

  const attendable = roster.filter((entry) => entry.status === "CONFIRMED");
  const [present, setPresent] = useState(() =>
    Object.fromEntries(attendable.map((entry) => [entry.id, entry.attendance !== "ABSENT"])),
  );

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post(`/api/tutor/groups/${sessionId}/attendance`, {
      attendance: attendable.map((entry) => ({
        enrolmentId: entry.id,
        attended: Boolean(present[entry.id]),
      })),
    });
    toast.success(
      "Attendance recorded",
      `${result.present} attended, ${result.absent} did not.`,
    );
    router.refresh();
  });

  if (attendable.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Attendance"
        description="Mark who turned up to close the session and release your earnings."
      />
      <CardBody className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Alert tone="neutral" title="What marking somebody absent does">
          Their lesson is recorded as a no-show, and the platform&rsquo;s usual no-show policy
          decides any refund. It is the same rule as a one-to-one lesson.
        </Alert>

        {attendable.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-ink-200 p-3">
            <Switch
              label={entry.studentName}
              description={entry.gradeName ?? undefined}
              checked={Boolean(present[entry.id])}
              onChange={(e) =>
                setPresent((current) => ({ ...current, [entry.id]: e.target.checked }))
              }
            />
          </div>
        ))}

        <Button
          onClick={submit}
          loading={pending}
          iconLeft={<ClipboardCheck className="size-4" />}
        >
          Record attendance
        </Button>
      </CardBody>
    </Card>
  );
}
