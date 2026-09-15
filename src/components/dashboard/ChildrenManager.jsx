"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil, Archive, GraduationCap, School } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Avatar, Badge, Button, Card, CardBody, ConfirmModal, EmptyState, Field, Input,
  Modal, Select, Switch, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * Child / student profiles (§5).
 *
 * Grade and courses are what tutors actually need, so they are first-class
 * fields rather than free text. The minor-privacy switch controls whether a
 * tutor sees a full surname (§35).
 */
export function ChildrenManager({ students, grades, subjects, canManage }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);

  // ?new=1 from elsewhere in the app opens the form straight away, adjusted
  // during render so the modal appears on the first paint.
  const [lastParams, setLastParams] = useState(params);
  if (lastParams !== params) {
    setLastParams(params);
    if (params.get("new") === "1") setEditing({});
  }

  if (students.length === 0 && !editing) {
    return (
      <EmptyState
        icon={<GraduationCap className="size-7" />}
        title="No children added yet"
        description="Add your child's grade and courses so tutors know exactly what they're preparing for."
        action={
          canManage && (
            <Button onClick={() => setEditing({})} iconLeft={<Plus className="size-4" />}>
              Add a child
            </Button>
          )
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => (
          <Card key={student.id}>
            <CardBody>
              <div className="flex items-start gap-3">
                <Avatar
                  src={student.avatarUrl}
                  firstName={student.firstName}
                  lastName={student.lastName}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-ink-900">
                    {student.firstName} {student.lastName}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {student.gradeName && <Badge tone="brand" size="sm">{student.gradeName}</Badge>}
                    {student.isSelf && <Badge tone="neutral" size="sm">You</Badge>}
                    {student.isMinor && !student.shareFullNameWithTutor && (
                      <Badge tone="success" size="sm">Name protected</Badge>
                    )}
                  </div>
                </div>
              </div>

              {student.school && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
                  <School className="size-3.5" />
                  {student.school}
                </p>
              )}

              {student.notes && (
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-500">
                  {student.notes}
                </p>
              )}

              <div className="mt-4 flex gap-2 border-t border-ink-100 pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(student)}
                  iconLeft={<Pencil className="size-3.5" />}
                >
                  Edit
                </Button>
                {!student.isSelf && canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setArchiving(student)}
                    iconLeft={<Archive className="size-3.5" />}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        ))}

        {canManage && (
          <button
            type="button"
            onClick={() => setEditing({})}
            className="flex min-h-40 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-600"
          >
            <Plus className="size-6" />
            <span className="mt-2 text-sm font-semibold">Add another child</span>
          </button>
        )}
      </div>

      <ChildForm
        open={Boolean(editing)}
        student={editing}
        grades={grades}
        subjects={subjects}
        onClose={() => {
          setEditing(null);
          router.replace("/children");
        }}
      />

      <ConfirmModal
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Remove ${archiving?.firstName}?`}
        description="Their lesson history and receipts are kept, but they won't appear when booking."
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await api.delete(`/api/students/${archiving.id}`);
            toast.success(`${archiving.firstName} removed`);
            setArchiving(null);
            router.refresh();
          } catch (error) {
            toast.error("Couldn't remove", error.message);
          }
        }}
      />
    </>
  );
}

function ChildForm({ open, student, grades, subjects, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(student?.id);

  const [form, setForm] = useState({});

  // Seed the form when the modal opens on a different student. A `_seeded`
  // marker makes this idempotent, so it runs once per open rather than on
  // every render.
  const seedKey = open ? (student?.id ?? "new") : null;
  if (seedKey && form._seeded !== seedKey) {
    setForm({
      _seeded: seedKey,
      firstName: student?.firstName ?? "",
      lastName: student?.lastName ?? "",
      birthYear: student?.birthYear ?? "",
      gradeId: student?.gradeId?.id ?? student?.gradeId ?? "",
      school: student?.school ?? "",
      notes: student?.notes ?? "",
      accessibilityNeeds: student?.accessibilityNeeds ?? "",
      shareFullNameWithTutor: student?.shareFullNameWithTutor ?? false,
    });
  }

  const set = (key) => (event) =>
    setForm((f) => ({
      ...f,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = {
      ...form,
      birthYear: form.birthYear ? Number(form.birthYear) : undefined,
      gradeId: form.gradeId || undefined,
      lastName: form.lastName || undefined,
      school: form.school || undefined,
      notes: form.notes || undefined,
      accessibilityNeeds: form.accessibilityNeeds || undefined,
    };

    if (isEdit) await api.patch(`/api/students/${student.id}`, payload);
    else await api.post("/api/students", payload);

    toast.success(isEdit ? "Profile updated" : `${form.firstName} added`);
    onClose();
    router.refresh();
  });

  const currentYear = new Date().getFullYear();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${student.firstName}'s profile` : "Add a child"}
      description="Grade and courses help tutors prepare — everything else is optional."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!form.firstName}>
            {isEdit ? "Save changes" : "Add child"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="child-first" error={fieldErrors.firstName} required>
            <Input
              id="child-first"
              value={form.firstName ?? ""}
              onChange={set("firstName")}
              error={fieldErrors.firstName}
            />
          </Field>
          <Field label="Last name" htmlFor="child-last" error={fieldErrors.lastName}>
            <Input
              id="child-last"
              value={form.lastName ?? ""}
              onChange={set("lastName")}
              error={fieldErrors.lastName}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Grade" htmlFor="child-grade" error={fieldErrors.gradeId}>
            <Select id="child-grade" value={form.gradeId ?? ""} onChange={set("gradeId")}>
              <option value="">Choose a grade</option>
              {grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Year of birth"
            htmlFor="child-birth"
            hint="We only store the year, never a full date of birth."
            error={fieldErrors.birthYear}
          >
            <Select id="child-birth" value={form.birthYear ?? ""} onChange={set("birthYear")}>
              <option value="">Prefer not to say</option>
              {Array.from({ length: 25 }, (_, i) => currentYear - 4 - i).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="School" htmlFor="child-school" hint="Optional">
          <Input
            id="child-school"
            value={form.school ?? ""}
            onChange={set("school")}
            placeholder="North Toronto Collegiate"
          />
        </Field>

        <Field
          label="What would you like help with?"
          htmlFor="child-notes"
          hint="Shared with tutors you book, so they can prepare."
        >
          <Textarea
            id="child-notes"
            rows={3}
            value={form.notes ?? ""}
            onChange={set("notes")}
            maxLength={1500}
            placeholder="Currently around 72 in MHF4U. Struggles with multi-step problems under time pressure."
          />
        </Field>

        <Field
          label="Accessibility or learning needs"
          htmlFor="child-needs"
          hint="Only shared with tutors you book. Helps them adapt their approach."
        >
          <Textarea
            id="child-needs"
            rows={2}
            value={form.accessibilityNeeds ?? ""}
            onChange={set("accessibilityNeeds")}
            maxLength={1000}
            placeholder="Diagnosed with ADHD — works best in shorter sessions with breaks."
          />
        </Field>

        <div className="rounded-xl border border-ink-200 p-4">
          <Switch
            label="Share their full name with tutors"
            description="Off by default. Tutors see a first name and last initial, which is enough to teach."
            checked={form.shareFullNameWithTutor ?? false}
            onChange={set("shareFullNameWithTutor")}
          />
        </div>
      </div>
    </Modal>
  );
}
