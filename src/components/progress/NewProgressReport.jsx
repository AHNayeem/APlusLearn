"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Select, FormErrorSummary, EmptyState, useToast,
} from "@/components/ui";
import { formatRelative } from "@/lib/utils/format";

/**
 * Start a report.
 *
 * The picker only offers learners this tutor has completed lessons with — the
 * same rule the server enforces, shown here so the refusal is a fact about
 * the list rather than an error after the fact.
 */
export function NewProgressReport({ students }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [studentProfileId, setStudentProfileId] = useState(students[0]?.id ?? "");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const student = students.find((s) => s.id === studentProfileId);
    const { report } = await api.post("/api/tutor/progress", {
      studentProfileId,
      courseId: student?.courseId,
    });
    toast.success("Draft started", "Nobody sees it until you share it.");
    setOpen(false);
    router.push(`/tutor/progress/${report.id}`);
  });

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={students.length === 0}
        iconLeft={<FilePlus2 className="size-4" />}
      >
        New report
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Start a progress report"
        description="We'll pull in the lessons you've completed with them, and their learning goals."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={pending} disabled={!studentProfileId}>
              Start draft
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          {students.length === 0 ? (
            <EmptyState
              title="No students yet"
              description="You can write a progress report once you've completed a lesson with someone."
            />
          ) : (
            <Field label="Who is it for?" htmlFor="report-student" required>
              <Select
                id="report-student"
                value={studentProfileId}
                onChange={(e) => setStudentProfileId(e.target.value)}
              >
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.displayName} — {student.lessons} lesson
                    {student.lessons === 1 ? "" : "s"}
                    {student.lastLessonAt ? `, last ${formatRelative(student.lastLessonAt)}` : ""}
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
