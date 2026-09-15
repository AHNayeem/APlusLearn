"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { api, qs } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input,
  Modal, Select, Tabs, Textarea, Table, THead, TH, TBody, TR, TD,
  FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * Curriculum management (§13, §24).
 *
 * Provinces, grades, subjects and courses are all editable here so a new
 * province can be opened without a deploy.
 */
export function CurriculumManager({ provinces, grades, subjects, courses, courseTotal }) {
  return (
    <Tabs
      tabs={[
        { value: "courses", label: "Courses", count: courseTotal },
        { value: "subjects", label: "Subjects", count: subjects.length },
        { value: "grades", label: "Grades", count: grades.length },
        { value: "provinces", label: "Provinces", count: provinces.length },
      ]}
    >
      {(active) => (
        <>
          {active === "courses" && (
            <CoursesTab
              courses={courses}
              provinces={provinces}
              grades={grades}
              subjects={subjects}
            />
          )}
          {active === "subjects" && <SubjectsTab subjects={subjects} />}
          {active === "grades" && <GradesTab grades={grades} provinces={provinces} />}
          {active === "provinces" && <ProvincesTab provinces={provinces} />}
        </>
      )}
    </Tabs>
  );
}

// --- Courses ---------------------------------------------------------------

function CoursesTab({ courses, provinces, grades, subjects }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form action="/admin/curriculum" className="flex max-w-sm flex-1 gap-2">
          <input
            name="q"
            placeholder="Search courses"
            aria-label="Search courses"
            className="h-10 flex-1 rounded-xl border-0 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
          <Button type="submit" variant="secondary" size="sm" iconLeft={<Search className="size-4" />}>
            Search
          </Button>
        </form>
        <Button onClick={() => setEditing({})} iconLeft={<Plus className="size-4" />}>
          Add course
        </Button>
      </div>

      {courses.length === 0 ? (
        <EmptyState title="No courses" description="Add the first course for this province." />
      ) : (
        <Table className="min-w-[760px]">
          <THead>
            <TH>Code</TH>
            <TH>Name</TH>
            <TH>Grade</TH>
            <TH>Subject</TH>
            <TH align="center">Tutors</TH>
            <TH>Status</TH>
            <TH align="right">Actions</TH>
          </THead>
          <TBody>
            {courses.map((course) => (
              <TR key={course.id}>
                <TD>
                  <span className="font-bold text-ink-900">{course.code ?? "—"}</span>
                </TD>
                <TD>
                  <span className="block font-medium text-ink-800">{course.name}</span>
                  {course.stream && (
                    <span className="block text-xs text-ink-500">{course.stream}</span>
                  )}
                </TD>
                <TD className="text-sm">Grade {course.gradeLevel}</TD>
                <TD className="text-sm">{course.subjectName}</TD>
                <TD align="center" className="tabular-nums">
                  {course.tutorCount ?? 0}
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={course.isActive ? "success" : "neutral"} size="sm">
                      {course.isActive ? "Active" : "Hidden"}
                    </Badge>
                    {course.isPopular && (
                      <Badge tone="accent" size="sm">
                        Popular
                      </Badge>
                    )}
                  </div>
                </TD>
                <TD align="right">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing(course)}
                      aria-label={`Edit ${course.name}`}
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(course)}
                      aria-label={`Delete ${course.name}`}
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <CourseForm
        open={Boolean(editing)}
        course={editing}
        provinces={provinces}
        grades={grades}
        subjects={subjects}
        onClose={() => setEditing(null)}
      />

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Courses that tutors still teach can't be deleted — deactivate them instead."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await api.delete(`/api/admin/curriculum/courses/${deleting.id}`);
                  toast.success("Course deleted");
                  setDeleting(null);
                  router.refresh();
                } catch (error) {
                  toast.error("Couldn't delete", error.message);
                }
              }}
            >
              Delete course
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          {deleting?.tutorCount > 0
            ? `${deleting.tutorCount} tutors currently teach this course. Deactivate it instead.`
            : "This can't be undone."}
        </p>
      </Modal>
    </>
  );
}

function CourseForm({ open, course, provinces, grades, subjects, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(course?.id);

  const [form, setForm] = useState({});

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  // Seed the form whenever the modal opens.
  if (open && form._seeded !== (course?.id ?? "new")) {
    setForm({
      _seeded: course?.id ?? "new",
      provinceId: course?.provinceId ?? provinces.find((p) => p.isActive)?.id ?? "",
      gradeId: course?.gradeId ?? "",
      subjectId: course?.subjectId ?? "",
      name: course?.name ?? "",
      code: course?.code ?? "",
      description: course?.description ?? "",
      stream: course?.stream ?? "",
      credits: course?.credits ?? "",
      isPopular: course?.isPopular ?? false,
      isActive: course?.isActive ?? true,
    });
  }

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = {
      provinceId: form.provinceId,
      gradeId: form.gradeId,
      subjectId: form.subjectId,
      name: form.name,
      code: form.code || undefined,
      description: form.description || undefined,
      stream: form.stream || undefined,
      credits: form.credits ? Number(form.credits) : undefined,
      isPopular: form.isPopular,
      isActive: form.isActive,
    };

    if (isEdit) await api.patch(`/api/admin/curriculum/courses/${course.id}`, payload);
    else await api.post("/api/admin/curriculum/courses", payload);

    toast.success(isEdit ? "Course updated" : "Course added");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${course.name}` : "Add a course"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!form.name || !form.gradeId}>
            {isEdit ? "Save changes" : "Add course"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Province" htmlFor="course-province" error={fieldErrors.provinceId} required>
            <Select id="course-province" value={form.provinceId ?? ""} onChange={set("provinceId")}>
              {provinces.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grade" htmlFor="course-grade" error={fieldErrors.gradeId} required>
            <Select id="course-grade" value={form.gradeId ?? ""} onChange={set("gradeId")}>
              <option value="">Choose</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Subject" htmlFor="course-subject" error={fieldErrors.subjectId} required>
            <Select id="course-subject" value={form.subjectId ?? ""} onChange={set("subjectId")}>
              <option value="">Choose</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label="Course name" htmlFor="course-name" error={fieldErrors.name} required>
            <Input
              id="course-name"
              value={form.name ?? ""}
              onChange={set("name")}
              error={fieldErrors.name}
              placeholder="Advanced Functions"
            />
          </Field>
          <Field
            label="Course code"
            htmlFor="course-code"
            hint="Optional"
            error={fieldErrors.code}
          >
            <Input
              id="course-code"
              value={form.code ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              error={fieldErrors.code}
              placeholder="MHF4U"
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="course-description">
          <Textarea
            id="course-description"
            rows={3}
            value={form.description ?? ""}
            onChange={set("description")}
            maxLength={600}
            placeholder="Polynomial, rational, logarithmic and trigonometric functions…"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Stream" htmlFor="course-stream" hint="University, College, Academic…">
            <Input
              id="course-stream"
              value={form.stream ?? ""}
              onChange={set("stream")}
              placeholder="University"
            />
          </Field>
          <Field label="Credits" htmlFor="course-credits">
            <Input
              id="course-credits"
              type="number"
              step="0.5"
              min={0}
              value={form.credits ?? ""}
              onChange={set("credits")}
              placeholder="1"
            />
          </Field>
        </div>

        <div className="space-y-3 rounded-xl border border-ink-200 p-4">
          <Checkbox
            label="Active"
            description="Inactive courses are hidden from search and tutor onboarding."
            checked={form.isActive ?? true}
            onChange={set("isActive")}
          />
          <Checkbox
            label="Popular"
            description="Featured on the homepage and course listings."
            checked={form.isPopular ?? false}
            onChange={set("isPopular")}
          />
        </div>
      </div>
    </Modal>
  );
}

// --- Subjects, grades, provinces -------------------------------------------

function SubjectsTab({ subjects }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(null);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({})} iconLeft={<Plus className="size-4" />}>
          Add subject
        </Button>
      </div>

      <Table>
        <THead>
          <TH>Subject</TH>
          <TH>Description</TH>
          <TH>Status</TH>
          <TH align="right">Action</TH>
        </THead>
        <TBody>
          {subjects.map((subject) => (
            <TR key={subject.id}>
              <TD className="font-semibold text-ink-900">{subject.name}</TD>
              <TD className="max-w-md text-sm text-ink-600">{subject.description}</TD>
              <TD>
                <div className="flex gap-1">
                  <Badge tone={subject.isActive ? "success" : "neutral"} size="sm">
                    {subject.isActive ? "Active" : "Hidden"}
                  </Badge>
                  {subject.isPopular && (
                    <Badge tone="accent" size="sm">
                      Popular
                    </Badge>
                  )}
                </div>
              </TD>
              <TD align="right">
                <button
                  type="button"
                  onClick={() => setEditing(subject)}
                  aria-label={`Edit ${subject.name}`}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                >
                  <Pencil className="size-3.5" />
                </button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <SimpleForm
        open={Boolean(editing)}
        entity={editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : "Add a subject"}
        endpoint="/api/admin/curriculum/subjects"
        fields={[
          { key: "name", label: "Name", required: true, placeholder: "Mathematics" },
          { key: "shortName", label: "Short name", placeholder: "Math" },
          { key: "description", label: "Description", type: "textarea" },
          { key: "icon", label: "Icon", hint: "A lucide-react icon name", placeholder: "Sigma" },
          { key: "displayOrder", label: "Display order", type: "number" },
          { key: "isPopular", label: "Popular", type: "checkbox" },
          { key: "isActive", label: "Active", type: "checkbox", defaultValue: true },
        ]}
      />
    </>
  );
}

function GradesTab({ grades, provinces }) {
  const [editing, setEditing] = useState(null);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({})} iconLeft={<Plus className="size-4" />}>
          Add grade
        </Button>
      </div>

      <Table>
        <THead>
          <TH>Grade</TH>
          <TH>Level</TH>
          <TH>Stage</TH>
          <TH>Status</TH>
          <TH align="right">Action</TH>
        </THead>
        <TBody>
          {grades.map((grade) => (
            <TR key={grade.id}>
              <TD className="font-semibold text-ink-900">{grade.name}</TD>
              <TD className="tabular-nums">{grade.level}</TD>
              <TD className="text-sm capitalize">{grade.stage?.toLowerCase()}</TD>
              <TD>
                <Badge tone={grade.isActive ? "success" : "neutral"} size="sm">
                  {grade.isActive ? "Active" : "Hidden"}
                </Badge>
              </TD>
              <TD align="right">
                <button
                  type="button"
                  onClick={() => setEditing(grade)}
                  aria-label={`Edit ${grade.name}`}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                >
                  <Pencil className="size-3.5" />
                </button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <SimpleForm
        open={Boolean(editing)}
        entity={editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : "Add a grade"}
        endpoint="/api/admin/curriculum/grades"
        fields={[
          {
            key: "provinceId",
            label: "Province",
            type: "select",
            required: true,
            options: provinces.map((p) => ({ value: p.id, label: p.name })),
          },
          { key: "name", label: "Name", required: true, placeholder: "Grade 12" },
          { key: "level", label: "Level", type: "number", required: true },
          {
            key: "stage",
            label: "Stage",
            type: "select",
            required: true,
            options: [
              { value: "ELEMENTARY", label: "Elementary" },
              { value: "MIDDLE", label: "Middle" },
              { value: "SECONDARY", label: "Secondary" },
            ],
          },
          { key: "isActive", label: "Active", type: "checkbox", defaultValue: true },
        ]}
      />
    </>
  );
}

function ProvincesTab({ provinces }) {
  const [editing, setEditing] = useState(null);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing({})} iconLeft={<Plus className="size-4" />}>
          Add province
        </Button>
      </div>

      <Table>
        <THead>
          <TH>Province</TH>
          <TH>Code</TH>
          <TH>Course codes</TH>
          <TH>Status</TH>
          <TH align="right">Action</TH>
        </THead>
        <TBody>
          {provinces.map((province) => (
            <TR key={province.id}>
              <TD className="font-semibold text-ink-900">{province.name}</TD>
              <TD className="font-mono text-sm">{province.code}</TD>
              <TD className="text-sm">
                {province.usesCourseCodes ? province.courseCodeHint ?? "Yes" : "No"}
              </TD>
              <TD>
                <Badge tone={province.isActive ? "success" : "neutral"} size="sm">
                  {province.isActive ? "Open" : "Coming soon"}
                </Badge>
              </TD>
              <TD align="right">
                <button
                  type="button"
                  onClick={() => setEditing(province)}
                  aria-label={`Edit ${province.name}`}
                  className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                >
                  <Pencil className="size-3.5" />
                </button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <SimpleForm
        open={Boolean(editing)}
        entity={editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${editing.name}` : "Add a province"}
        endpoint="/api/admin/curriculum/provinces"
        fields={[
          { key: "code", label: "Code", required: true, placeholder: "ON", uppercase: true },
          { key: "name", label: "Name", required: true, placeholder: "Ontario" },
          {
            key: "usesCourseCodes",
            label: "Uses course codes",
            type: "checkbox",
          },
          {
            key: "courseCodeHint",
            label: "Course code example",
            placeholder: "e.g. MHF4U",
          },
          { key: "displayOrder", label: "Display order", type: "number" },
          {
            key: "isActive",
            label: "Open for search",
            type: "checkbox",
            hint: "Inactive provinces appear as 'coming soon'.",
          },
        ]}
      />
    </>
  );
}

/** A small generic create/edit form driven by a field descriptor list. */
function SimpleForm({ open, entity, onClose, title, endpoint, fields }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(entity?.id);
  const [form, setForm] = useState({});

  if (open && form._seeded !== (entity?.id ?? "new")) {
    const seeded = { _seeded: entity?.id ?? "new" };
    for (const field of fields) {
      seeded[field.key] = entity?.[field.key] ?? field.defaultValue ?? (field.type === "checkbox" ? false : "");
    }
    setForm(seeded);
  }

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = {};
    for (const field of fields) {
      const value = form[field.key];
      if (value === "" || value === undefined) continue;
      payload[field.key] = field.type === "number" ? Number(value) : value;
    }
    // Checkboxes must be sent even when false.
    for (const field of fields.filter((f) => f.type === "checkbox")) {
      payload[field.key] = Boolean(form[field.key]);
    }

    if (isEdit) await api.patch(`${endpoint}/${entity.id}`, payload);
    else await api.post(endpoint, payload);

    toast.success(isEdit ? "Saved" : "Added");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            {isEdit ? "Save changes" : "Add"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        {fields.map((field) => {
          if (field.type === "checkbox") {
            return (
              <Checkbox
                key={field.key}
                label={field.label}
                description={field.hint}
                checked={Boolean(form[field.key])}
                onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.checked }))}
              />
            );
          }

          return (
            <Field
              key={field.key}
              label={field.label}
              htmlFor={`field-${field.key}`}
              hint={field.hint}
              error={fieldErrors[field.key]}
              required={field.required}
            >
              {field.type === "select" ? (
                <Select
                  id={`field-${field.key}`}
                  value={form[field.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                >
                  <option value="">Choose</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              ) : field.type === "textarea" ? (
                <Textarea
                  id={`field-${field.key}`}
                  rows={3}
                  value={form[field.key] ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, [field.key]: e.target.value }))}
                  error={fieldErrors[field.key]}
                />
              ) : (
                <Input
                  id={`field-${field.key}`}
                  type={field.type ?? "text"}
                  value={form[field.key] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      [field.key]: field.uppercase ? e.target.value.toUpperCase() : e.target.value,
                    }))
                  }
                  error={fieldErrors[field.key]}
                  placeholder={field.placeholder}
                />
              )}
            </Field>
          );
        })}
      </div>
    </Modal>
  );
}
